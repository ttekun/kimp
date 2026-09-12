import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BINANCE_INITIAL_BACKOFF_MS,
  BINANCE_MAX_BACKOFF_MS,
  BINANCE_MAX_CONNECTION_LIFETIME_MS,
  BinanceConnector,
  buildBinanceCombinedStreamUrl,
  type InjectableWebSocket,
  type WebSocketCtor,
} from '../../src/connectors/binance.js';
import { BINANCE_MARKET_CODES, COIN_SYMBOLS } from '../../src/core/symbols.js';
import { binanceRestFixture, binanceWsBtcFixture } from './fixtures/binance.js';

class MockWebSocket extends EventEmitter implements InjectableWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;

  readyState = MockWebSocket.CONNECTING;

  constructor(public readonly url: string) {
    super();
  }

  close(): void {
    this.readyState = 3;
  }

  removeAllListeners(event?: string): this {
    return super.removeAllListeners(event);
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  simulateMessage(payload: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
  }

  simulateClose(code = 1006): void {
    this.readyState = 3;
    this.emit('close', code, Buffer.from(''));
  }

  simulateError(message: string): void {
    this.emit('error', new Error(message));
  }

  simulateErrorThenClose(message: string, code = 1006): void {
    this.emit('error', new Error(message));
    this.readyState = 3;
    this.emit('close', code, Buffer.from(''));
  }

  simulatePing(): void {
    this.emit('ping');
  }
}

function createMockWebSocketFactory(): {
  ctor: WebSocketCtor;
  instances: MockWebSocket[];
} {
  const instances: MockWebSocket[] = [];

  const ctor: WebSocketCtor = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      instances.push(this);
    }
  };

  return { ctor, instances };
}

function createMockFetch(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): typeof fetch {
  const { ok = true, status = 200 } = init;

  return vi.fn(async () => ({
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('BinanceConnector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects to the combined miniTicker stream URL for every coin', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
    });

    await connector.start();

    expect(instances[0]?.url).toBe(buildBinanceCombinedStreamUrl());
    expect(buildBinanceCombinedStreamUrl()).toContain(`${BINANCE_MARKET_CODES.BTC}@miniTicker`);
    expect(buildBinanceCombinedStreamUrl()).toContain(`${BINANCE_MARKET_CODES.DOT}@miniTicker`);
    expect(buildBinanceCombinedStreamUrl()).toContain(`${BINANCE_MARKET_CODES.DOGE}@miniTicker`);
    expect(COIN_SYMBOLS).toHaveLength(6);

    connector.stop();
  });

  it('honors BINANCE_WS_BASE_URL for market-data-only hosts', () => {
    vi.stubEnv('BINANCE_WS_BASE_URL', 'wss://data-stream.binance.vision:9443');
    expect(buildBinanceCombinedStreamUrl()).toContain(
      'wss://data-stream.binance.vision:9443/stream',
    );
    vi.unstubAllEnvs();
  });

  it('invokes onTicker when a valid WS message arrives', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const onTicker = vi.fn();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker,
    });

    await connector.start();
    instances[0]?.simulateOpen();
    instances[0]?.simulateMessage(binanceWsBtcFixture);

    expect(onTicker).toHaveBeenCalledWith('BTC', {
      price: 63_067.02,
      ts: 1_786_887_568_015,
      status: 'live',
    });
    expect(connector.getHealth().lastTickAt).toBe(1_786_887_568_015);

    connector.stop();
  });

  it('swallows malformed WS payloads without invoking callbacks', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const onTicker = vi.fn();
    const onMalformedMessage = vi.fn();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker,
      onMalformedMessage,
    });

    await connector.start();
    instances[0]?.simulateOpen();
    instances[0]?.simulateMessage({ nope: true });
    instances[0]?.simulateMessage('not-json');

    expect(onTicker).not.toHaveBeenCalled();
    expect(onMalformedMessage).toHaveBeenCalled();
    expect(connector.getHealth().status).toBe('connected');

    connector.stop();
  });

  it('classifies negative close price as malformed and keeps processing valid messages', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const onTicker = vi.fn();
    const onMalformedMessage = vi.fn();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker,
      onMalformedMessage,
    });

    await connector.start();
    instances[0]?.simulateOpen();

    instances[0]?.simulateMessage({
      stream: 'btcusdt@miniTicker',
      data: {
        ...binanceWsBtcFixture.data,
        c: '-1.00',
      },
    });

    expect(onTicker).not.toHaveBeenCalled();
    expect(onMalformedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'malformed_payload' }),
    );
    expect(connector.getHealth().status).toBe('connected');

    instances[0]?.simulateMessage(binanceWsBtcFixture);

    expect(onTicker).toHaveBeenCalledTimes(1);
    expect(connector.getHealth().lastTickAt).toBe(1_786_887_568_015);

    connector.stop();
  });

  it('handles server ping frames without disconnecting', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();
    instances[0]?.simulatePing();

    expect(connector.getHealth().status).toBe('connected');

    connector.stop();
  });

  it('schedules reconnect with exponential backoff on close', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();
    instances[0]?.simulateClose();

    expect(connector.getHealth().status).toBe('disconnected');
    expect(connector.getHealth().reconnectAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(BINANCE_INITIAL_BACKOFF_MS);
    expect(instances).toHaveLength(2);

    instances[1]?.simulateClose();
    expect(connector.getHealth().reconnectAttempts).toBe(2);

    await vi.advanceTimersByTimeAsync(BINANCE_INITIAL_BACKOFF_MS * 2);
    expect(instances).toHaveLength(3);

    connector.stop();
  });

  it('caps reconnect backoff at 30 seconds', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
    });

    await connector.start();

    let expectedDelay = BINANCE_INITIAL_BACKOFF_MS;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      instances.at(-1)?.simulateClose();
      expect(connector.getHealth().reconnectAttempts).toBe(attempt + 1);

      await vi.advanceTimersByTimeAsync(expectedDelay);
      expectedDelay = Math.min(expectedDelay * 2, BINANCE_MAX_BACKOFF_MS);
    }

    instances.at(-1)?.simulateClose();
    const beforeAttempts = connector.getHealth().reconnectAttempts;
    await vi.advanceTimersByTimeAsync(BINANCE_MAX_BACKOFF_MS);
    expect(instances.length).toBeGreaterThan(beforeAttempts);

    connector.stop();
  });

  it('proactively reconnects after the 24h connection lifetime threshold', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();

    expect(instances).toHaveLength(1);
    expect(connector.getHealth().reconnectAttempts).toBe(0);

    await vi.advanceTimersByTimeAsync(BINANCE_MAX_CONNECTION_LIFETIME_MS - 1);
    expect(instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(instances).toHaveLength(2);
    expect(connector.getHealth().reconnectAttempts).toBe(0);

    connector.stop();
  });

  it('records network errors and reconnects after WS error', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();
    instances[0]?.simulateError('getaddrinfo ENOTFOUND stream.binance.com');

    expect(connector.getHealth().lastError?.kind).toBe('dns_tls');

    await vi.advanceTimersByTimeAsync(BINANCE_INITIAL_BACKOFF_MS);
    expect(instances).toHaveLength(2);

    connector.stop();
  });

  it('increments reconnectAttempts once when error and close fire for the same socket', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();

    instances[0]?.simulateErrorThenClose('socket hang up');

    expect(connector.getHealth().reconnectAttempts).toBe(1);
    expect(connector.getHealth().status).toBe('disconnected');

    await vi.advanceTimersByTimeAsync(BINANCE_INITIAL_BACKOFF_MS);
    expect(instances).toHaveLength(2);

    connector.stop();
  });

  it('bootstraps tickers from REST via injected fetch', async () => {
    const onTicker = vi.fn();
    const connector = new BinanceConnector({
      WebSocketCtor: createMockWebSocketFactory().ctor,
      fetchFn: createMockFetch(binanceRestFixture),
      onTicker,
    });

    await connector.bootstrapFromRest();

    expect(onTicker).toHaveBeenCalledTimes(COIN_SYMBOLS.length);
    expect(onTicker).toHaveBeenCalledWith('BTC', expect.objectContaining({ price: 63_067.01 }));
    expect(onTicker).toHaveBeenCalledWith('DOGE', expect.objectContaining({ price: 0.1 }));

    connector.stop();
  });

  it('records REST HTTP failures without throwing and still opens WS on start', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch({}, { ok: false, status: 429 }),
      onTicker: vi.fn(),
    });

    await connector.start();

    expect(connector.getHealth().lastError?.kind).toBe('http_error');
    expect(instances).toHaveLength(1);

    connector.stop();
  });

  it('records REST HTTP body read failure without throwing and still opens WS on start', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => {
        throw new Error('connection reset while reading body');
      },
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn,
      onTicker: vi.fn(),
    });

    await connector.start();

    expect(connector.getHealth().lastError?.kind).toBe('http_error');
    expect(connector.getHealth().lastError?.message).toBe('HTTP 429: ');
    expect(instances).toHaveLength(1);

    connector.stop();
  });

  it('records malformed REST JSON and still opens WS on start', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'not-json',
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    })) as unknown as typeof fetch;

    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn,
      onTicker: vi.fn(),
    });

    await connector.start();

    expect(connector.getHealth().lastError?.kind).toBe('malformed_payload');
    expect(instances).toHaveLength(1);

    connector.stop();
  });

  it('records REST fetch rejection and still opens WS on start', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const fetchFn = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.binance.com');
    }) as unknown as typeof fetch;

    const connector = new BinanceConnector({
      WebSocketCtor: ctor,
      fetchFn,
      onTicker: vi.fn(),
    });

    await connector.start();

    expect(connector.getHealth().lastError?.kind).toBe('dns_tls');
    expect(instances).toHaveLength(1);

    connector.stop();
  });
});
