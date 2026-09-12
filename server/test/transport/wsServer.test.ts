import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { createAggregatorSnapshotStore } from '../../src/aggregator/state.js';
import { createEmptySnapshot } from '../../src/core/snapshot.js';
import type { BinanceTicker, UpbitTicker } from '../../src/core/types.js';
import { buildHttpApi } from '../../src/transport/httpApi.js';
import type { HealthSummary } from '../../src/transport/health.js';
import {
  createWsBroadcaster,
  WS_BROADCAST_INTERVAL_MS,
  WS_MAX_BUFFERED_BYTES,
  WS_MAX_CONSECUTIVE_SKIPS,
} from '../../src/transport/wsServer.js';

const BASE_TS = 1_000_000;
const tempDirs: string[] = [];

function sampleHealth(): HealthSummary {
  return {
    ok: true,
    connectors: {
      upbit: { status: 'live', lastTickAgeMs: 100, reconnects: 0, lastError: null },
      binance: { status: 'live', lastTickAgeMs: 200, reconnects: 0, lastError: null },
      bitbank: { status: 'stale', lastTickAgeMs: 35_000, reconnects: 1, lastError: null },
      fx: { status: 'live', lastTickAgeMs: 3_600_000, reconnects: 0, lastError: null },
    },
  };
}

function makeUpbit(ts: number, overrides: Partial<UpbitTicker> = {}): UpbitTicker {
  return {
    price: 148_500_000,
    change24hPct: 0,
    volume24hKrw: 0,
    ts,
    status: 'live',
    ...overrides,
  };
}

function makeBinance(ts: number, overrides: Partial<BinanceTicker> = {}): BinanceTicker {
  return {
    price: 104_250.5,
    ts,
    status: 'live',
    ...overrides,
  };
}

type MockSocket = {
  OPEN: number;
  readyState: number;
  bufferedAmount: number;
  sent: string[];
  closeCalls: Array<{ code?: number; reason?: string }>;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  triggerClose: () => void;
  triggerError: () => void;
};

function createMockSocket(): MockSocket {
  const sent: string[] = [];
  const closeCalls: Array<{ code?: number; reason?: string }> = [];
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  let readyState: number = WebSocket.OPEN;
  let bufferedAmount = 0;

  const socket: MockSocket = {
    OPEN: WebSocket.OPEN,
    get readyState() {
      return readyState;
    },
    get bufferedAmount() {
      return bufferedAmount;
    },
    set bufferedAmount(value: number) {
      bufferedAmount = value;
    },
    sent,
    closeCalls,
    send: (data: string) => {
      sent.push(data);
    },
    close: (code?: number, reason?: string) => {
      closeCalls.push({ code, reason });
      readyState = WebSocket.CLOSED;
      for (const handler of listeners.close ?? []) {
        handler(code, reason);
      }
    },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    triggerClose: () => {
      readyState = WebSocket.CLOSED;
      for (const handler of listeners.close ?? []) {
        handler();
      }
    },
    triggerError: () => {
      for (const handler of listeners.error ?? []) {
        handler(new Error('mock socket error'));
      }
    },
  };

  return socket;
}

async function createStaticFixture(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `kimchi-static-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><html></html>', 'utf8');
  tempDirs.push(dir);
  return dir;
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (error) => reject(error));
  });
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) =>
        import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true })),
      ),
  );
});

describe('createWsBroadcaster with mock connectors', () => {
  it('pushes immediately on connect, coalesces to 1 Hz, matches getSnapshot, and cleans up on disconnect', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);

    const store = createAggregatorSnapshotStore(BASE_TS);
    store.onUpbitTicker('BTC', makeUpbit(BASE_TS, { price: 100_000_000 }));
    store.onBinanceTicker('BTC', makeBinance(BASE_TS, { price: 100_000 }));

    const broadcaster = createWsBroadcaster({
      getSnapshot: () => store.getSnapshot(),
      broadcastIntervalMs: WS_BROADCAST_INTERVAL_MS,
    });

    const socket = createMockSocket();
    broadcaster.addClient(socket as unknown as WebSocket);

    expect(socket.sent.length).toBe(1);
    expect(JSON.parse(socket.sent[0])).toEqual(store.getSnapshot());
    expect(broadcaster.getClientCount()).toBe(1);

    store.onBinanceTicker('BTC', makeBinance(BASE_TS, { price: 101_000 }));
    store.onBinanceTicker('BTC', makeBinance(BASE_TS, { price: 102_000 }));
    store.onBinanceTicker('BTC', makeBinance(BASE_TS, { price: 103_000 }));

    vi.advanceTimersByTime(500);
    expect(socket.sent.length).toBe(1);

    vi.advanceTimersByTime(500);

    expect(socket.sent.length).toBe(2);
    const latestSnapshot = store.getSnapshot();
    expect(JSON.parse(socket.sent[1])).toEqual(latestSnapshot);
    expect(latestSnapshot.coins.BTC.binance?.price).toBe(103_000);

    const httpSnapshot = store.getSnapshot();
    expect(JSON.parse(socket.sent[1])).toEqual(httpSnapshot);

    vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS);
    expect(socket.sent.length).toBe(3);

    socket.triggerClose();
    expect(broadcaster.getClientCount()).toBe(0);

    vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS * 3);
    expect(socket.sent.length).toBe(3);
  });

  it('skips a push when the client buffer is still draining', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);

    const store = createAggregatorSnapshotStore(BASE_TS);
    const broadcaster = createWsBroadcaster({
      getSnapshot: () => store.getSnapshot(),
      broadcastIntervalMs: WS_BROADCAST_INTERVAL_MS,
    });

    const socket = createMockSocket();
    socket.bufferedAmount = 1_024;
    broadcaster.addClient(socket as unknown as WebSocket);

    expect(socket.sent.length).toBe(0);

    socket.bufferedAmount = 0;
    vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS);
    expect(socket.sent.length).toBe(1);
  });

  it('disconnects a permanently stalled client after consecutive skip threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);

    const store = createAggregatorSnapshotStore(BASE_TS);
    const broadcaster = createWsBroadcaster({
      getSnapshot: () => store.getSnapshot(),
      broadcastIntervalMs: WS_BROADCAST_INTERVAL_MS,
    });

    const socket = createMockSocket();
    socket.bufferedAmount = 100;
    broadcaster.addClient(socket as unknown as WebSocket);

    expect(socket.sent.length).toBe(0);
    expect(broadcaster.getClientCount()).toBe(1);

    for (let tick = 0; tick < WS_MAX_CONSECUTIVE_SKIPS - 2; tick += 1) {
      vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS);
      expect(broadcaster.getClientCount()).toBe(1);
      expect(socket.closeCalls.length).toBe(0);
      expect(socket.sent.length).toBe(0);
    }

    vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS);
    expect(socket.closeCalls).toEqual([{ code: 1008, reason: 'backpressure' }]);
    expect(broadcaster.getClientCount()).toBe(0);
    expect(socket.sent.length).toBe(0);
  });

  it('resets the consecutive skip counter when the client buffer drains', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);

    const store = createAggregatorSnapshotStore(BASE_TS);
    const broadcaster = createWsBroadcaster({
      getSnapshot: () => store.getSnapshot(),
      broadcastIntervalMs: WS_BROADCAST_INTERVAL_MS,
    });

    const socket = createMockSocket();
    socket.bufferedAmount = 100;
    broadcaster.addClient(socket as unknown as WebSocket);

    const partialSkips = 5;
    for (let tick = 0; tick < partialSkips; tick += 1) {
      vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS);
    }
    expect(socket.sent.length).toBe(0);
    expect(broadcaster.getClientCount()).toBe(1);

    socket.bufferedAmount = 0;
    vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS);
    expect(socket.sent.length).toBe(1);
    expect(socket.closeCalls.length).toBe(0);

    socket.bufferedAmount = 100;
    for (let tick = 0; tick < WS_MAX_CONSECUTIVE_SKIPS - 1; tick += 1) {
      vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS);
    }
    expect(broadcaster.getClientCount()).toBe(1);
    expect(socket.closeCalls.length).toBe(0);

    vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS);
    expect(socket.closeCalls).toEqual([{ code: 1008, reason: 'backpressure' }]);
    expect(broadcaster.getClientCount()).toBe(0);
  });

  it('disconnects immediately when bufferedAmount exceeds the 64KB threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);

    const store = createAggregatorSnapshotStore(BASE_TS);
    const broadcaster = createWsBroadcaster({
      getSnapshot: () => store.getSnapshot(),
      broadcastIntervalMs: WS_BROADCAST_INTERVAL_MS,
    });

    const socket = createMockSocket();
    socket.bufferedAmount = WS_MAX_BUFFERED_BYTES + 1;
    broadcaster.addClient(socket as unknown as WebSocket);

    expect(socket.closeCalls).toEqual([{ code: 1008, reason: 'backpressure' }]);
    expect(broadcaster.getClientCount()).toBe(0);
    expect(socket.sent.length).toBe(0);
  });

  it('removes a client from the tracked set when only an error event fires', () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    const broadcaster = createWsBroadcaster({
      getSnapshot: () => store.getSnapshot(),
    });

    const socket = createMockSocket();
    broadcaster.addClient(socket as unknown as WebSocket);
    expect(broadcaster.getClientCount()).toBe(1);

    socket.triggerError();
    expect(broadcaster.getClientCount()).toBe(0);
  });

  it('stops the broadcast timer at zero clients and restarts cleanly on reconnect', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);

    const store = createAggregatorSnapshotStore(BASE_TS);
    const broadcaster = createWsBroadcaster({
      getSnapshot: () => store.getSnapshot(),
      broadcastIntervalMs: WS_BROADCAST_INTERVAL_MS,
    });

    const firstSocket = createMockSocket();
    broadcaster.addClient(firstSocket as unknown as WebSocket);
    expect(firstSocket.sent.length).toBe(1);

    firstSocket.triggerClose();
    expect(broadcaster.getClientCount()).toBe(0);

    vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS * 3);
    expect(firstSocket.sent.length).toBe(1);

    const secondSocket = createMockSocket();
    broadcaster.addClient(secondSocket as unknown as WebSocket);
    expect(secondSocket.sent.length).toBe(1);
    expect(broadcaster.getClientCount()).toBe(1);

    vi.advanceTimersByTime(WS_BROADCAST_INTERVAL_MS);
    expect(secondSocket.sent.length).toBe(2);
  });
});

describe('WS /ws integration with mock connectors', () => {
  it('delivers immediate and coalesced pushes over a real WebSocket connection', async () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    store.onUpbitTicker('BTC', makeUpbit(BASE_TS, { price: 88_000_000 }));
    store.onBinanceTicker('BTC', makeBinance(BASE_TS, { price: 88_000 }));

    const broadcastIntervalMs = 50;

    const app = await buildHttpApi({
      getSnapshot: () => store.getSnapshot(),
      getHealth: sampleHealth,
      staticRoot: await createStaticFixture(),
      wsBroadcastIntervalMs: broadcastIntervalMs,
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port =
      typeof address === 'object' && address !== null && 'port' in address ? address.port : 0;

    const messages: string[] = [];
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    client.on('message', (data) => messages.push(data.toString()));

    await waitForOpen(client);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const firstPayload = JSON.parse(messages[0]);
    expect(firstPayload.coins.BTC.upbit?.price).toBe(88_000_000);
    expect(firstPayload.coins.BTC.binance?.price).toBe(88_000);

    store.onBinanceTicker('BTC', makeBinance(BASE_TS, { price: 89_000 }));
    store.onBinanceTicker('BTC', makeBinance(BASE_TS, { price: 90_000 }));
    store.onBinanceTicker('BTC', makeBinance(BASE_TS, { price: 91_000 }));

    await new Promise((resolve) => setTimeout(resolve, broadcastIntervalMs + 25));

    const latestPayload = JSON.parse(messages[messages.length - 1]);
    const latestSnapshot = store.getSnapshot();
    expect(latestPayload.coins).toEqual(latestSnapshot.coins);
    expect(latestPayload.fx).toEqual(latestSnapshot.fx);
    expect(latestPayload.coins.BTC.binance?.price).toBe(91_000);
    // Coalescing: three ticks in one interval must not produce three extra pushes.
    expect(messages.length).toBeLessThanOrEqual(3);

    client.close();
    await new Promise<void>((resolve) => client.once('close', () => resolve()));

    await app.close();
  });
});

describe('buildHttpApi GET /api/snapshot parity', () => {
  it('returns the same snapshot shape the WS broadcaster would send', async () => {
    const snapshot = createEmptySnapshot(BASE_TS);
    const app = await buildHttpApi({
      getSnapshot: () => snapshot,
      getHealth: sampleHealth,
      staticRoot: await createStaticFixture(),
    });

    const response = await app.inject({ method: 'GET', url: '/api/snapshot' });
    expect(JSON.parse(response.body)).toEqual(snapshot);

    const broadcaster = createWsBroadcaster({ getSnapshot: () => snapshot });
    const socket = createMockSocket();
    broadcaster.addClient(socket as unknown as WebSocket);
    expect(JSON.parse(socket.sent[0])).toEqual(JSON.parse(response.body));

    broadcaster.destroy();
    await app.close();
  });
});
