import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMarketConnection,
  parseMarketSnapshot,
  resolveMarketEndpoints,
  REST_POLL_INTERVAL_MS,
  WS_RECONNECT_BASE_MS,
} from './marketConnection';
import type { MarketSnapshot } from './types';

const BASE_TS = 1_700_000_000_000;

function makeSnapshot(updatedAt = BASE_TS): MarketSnapshot {
  return {
    updatedAt,
    fx: {},
    coins: {
      BTC: {},
      ETH: {},
      XRP: {},
      SOL: {},
      DOT: {},
      DOGE: {},
    },
  };
}

type MockSocket = {
  url: string;
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
  simulateOpen: () => void;
  simulateMessage: (data: string) => void;
  simulateClose: () => void;
  simulateError: () => void;
};

function createMockWebSocketCtor(options?: {
  onConstruct?: () => void;
  throwOnConstruct?: boolean;
}) {
  const sockets: MockSocket[] = [];

  class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = MockWebSocket.CONNECTING;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    close = vi.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({} as CloseEvent);
    });

    constructor(url: string | URL) {
      if (options?.throwOnConstruct) {
        throw new Error('invalid WebSocket URL');
      }

      this.url = String(url);
      sockets.push(this as unknown as MockSocket);
      options?.onConstruct?.();
    }

    simulateOpen(this: MockSocket): void {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({} as Event);
    }

    simulateMessage(this: MockSocket, data: string): void {
      this.onmessage?.({ data } as MessageEvent);
    }

    simulateClose(this: MockSocket): void {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({} as CloseEvent);
    }

    simulateError(this: MockSocket): void {
      this.onerror?.({} as Event);
    }
  }

  return {
    WebSocketCtor: MockWebSocket as unknown as typeof WebSocket,
    getSockets: () => sockets as MockSocket[],
    getLatestSocket: () => sockets.at(-1) as MockSocket | undefined,
  };
}

function createAbortAwareFetch() {
  const pending: Array<{
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }> = [];

  const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const entry = { resolve, reject };
      pending.push(entry);

      const removePending = (): void => {
        const index = pending.indexOf(entry);
        if (index >= 0) {
          pending.splice(index, 1);
        }
      };

      signal?.addEventListener('abort', () => {
        removePending();
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  });

  const resolveNext = (response: Response): void => {
    const entry = pending.shift();
    entry?.resolve(response);
  };

  const rejectNext = (error: Error): void => {
    const entry = pending.shift();
    entry?.reject(error);
  };

  return { fetchFn, resolveNext, rejectNext, getPendingCount: () => pending.length };
}

function createAbortIgnoringFetch() {
  const pending: Array<{
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }> = [];

  const fetchFn = vi.fn(() => {
    return new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  });

  const resolveAt = (index: number, response: Response): void => {
    const entry = pending[index];
    if (entry === undefined) {
      throw new Error(`No pending fetch at index ${index}`);
    }
    entry.resolve(response);
  };

  return { fetchFn, resolveAt, getPendingCount: () => pending.length };
}

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
}

describe('parseMarketSnapshot', () => {
  it('accepts a well-formed snapshot', () => {
    expect(parseMarketSnapshot(makeSnapshot())).toEqual(makeSnapshot());
  });

  it('rejects malformed payloads', () => {
    expect(parseMarketSnapshot(null)).toBeNull();
    expect(parseMarketSnapshot({ updatedAt: 'nope', coins: {}, fx: {} })).toBeNull();
    expect(parseMarketSnapshot({ updatedAt: 1 })).toBeNull();
  });

  it('rejects snapshots missing required coin keys', () => {
    expect(parseMarketSnapshot({ updatedAt: BASE_TS, coins: {}, fx: {} })).toBeNull();
    expect(parseMarketSnapshot({ updatedAt: BASE_TS, coins: [], fx: {} })).toBeNull();
    expect(
      parseMarketSnapshot({ updatedAt: BASE_TS, coins: makeSnapshot().coins, fx: [] }),
    ).toBeNull();
    expect(
      parseMarketSnapshot({
        updatedAt: BASE_TS,
        coins: { BTC: {}, ETH: {}, XRP: {}, SOL: {} },
        fx: {},
      }),
    ).toBeNull();
    expect(
      parseMarketSnapshot({
        updatedAt: BASE_TS,
        coins: {
          BTC: {},
          ETH: {},
          XRP: {},
          SOL: {},
          DOT: null,
        },
        fx: {},
      }),
    ).toBeNull();
  });
});

describe('resolveMarketEndpoints', () => {
  it('maps https origins to wss and strips trailing slashes', () => {
    expect(resolveMarketEndpoints('https://example.com/')).toEqual({
      snapshotUrl: 'https://example.com/api/snapshot',
      wsUrl: 'wss://example.com/ws',
    });
  });

  it('maps http origins to ws', () => {
    expect(resolveMarketEndpoints('http://localhost:3000')).toEqual({
      snapshotUrl: 'http://localhost:3000/api/snapshot',
      wsUrl: 'ws://localhost:3000/ws',
    });
  });
});

describe('createMarketConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('populates snapshots from the initial REST fetch before any WS message', async () => {
    const restSnapshot = makeSnapshot(BASE_TS);
    const fetchFn = vi.fn(async () => Response.json(restSnapshot, { status: 200 }));
    const { WebSocketCtor } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();
    const onStatusChange = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot,
      onStatusChange,
    });

    connection.start();
    await vi.waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith(restSnapshot);
    });

    expect(onStatusChange).toHaveBeenCalledWith('connecting');
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('marks the connection live when a WS message arrives and updates the snapshot', async () => {
    const restSnapshot = makeSnapshot(BASE_TS);
    const wsSnapshot = makeSnapshot(BASE_TS + 1_000);
    const fetchFn = vi.fn(async () => Response.json(restSnapshot, { status: 200 }));
    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();
    const onStatusChange = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot,
      onStatusChange,
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
    });

    getLatestSocket()!.simulateOpen();
    getLatestSocket()!.simulateMessage(JSON.stringify(wsSnapshot));

    expect(onSnapshot).toHaveBeenLastCalledWith(wsSnapshot);
    expect(onStatusChange).toHaveBeenCalledWith('live');
  });

  it('enters reconnecting on WS disconnect and polls REST every 5 seconds', async () => {
    const restSnapshot = makeSnapshot(BASE_TS);
    const polledSnapshot = makeSnapshot(BASE_TS + 5_000);
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json(restSnapshot, { status: 200 }))
      .mockResolvedValue(Response.json(polledSnapshot, { status: 200 }));

    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();
    const onStatusChange = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot,
      onStatusChange,
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
    });

    getLatestSocket()!.simulateOpen();
    getLatestSocket()!.simulateMessage(JSON.stringify(restSnapshot));
    onSnapshot.mockClear();
    onStatusChange.mockClear();

    getLatestSocket()!.simulateClose();

    expect(onStatusChange).toHaveBeenCalledWith('reconnecting');
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(REST_POLL_INTERVAL_MS);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(onSnapshot).toHaveBeenCalledWith(polledSnapshot);

    await vi.advanceTimersByTimeAsync(REST_POLL_INTERVAL_MS);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('stops REST polling after the WS reconnects and delivers a message', async () => {
    const restSnapshot = makeSnapshot(BASE_TS);
    const fetchFn = vi.fn(async () => Response.json(restSnapshot, { status: 200 }));
    const { WebSocketCtor, getSockets } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();
    const onStatusChange = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      reconnectBaseMs: WS_RECONNECT_BASE_MS,
      onSnapshot,
      onStatusChange,
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getSockets()[0]).toBeDefined();
    });

    getSockets()[0]!.simulateOpen();
    getSockets()[0]!.simulateMessage(JSON.stringify(restSnapshot));
    getSockets()[0]!.simulateClose();

    const callsAfterDisconnect = fetchFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(REST_POLL_INTERVAL_MS);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterDisconnect);

    await vi.advanceTimersByTimeAsync(WS_RECONNECT_BASE_MS);
    const reconnected = getSockets().at(-1)!;
    reconnected.simulateOpen();
    reconnected.simulateMessage(JSON.stringify(makeSnapshot(BASE_TS + 9_000)));

    const callsAfterLive = fetchFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(REST_POLL_INTERVAL_MS * 2);
    expect(fetchFn.mock.calls.length).toBe(callsAfterLive);
    expect(onStatusChange).toHaveBeenCalledWith('live');
  });

  it('ignores malformed WS messages without corrupting the store', async () => {
    const restSnapshot = makeSnapshot(BASE_TS);
    const fetchFn = vi.fn(async () => Response.json(restSnapshot, { status: 200 }));
    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();
    const onStatusChange = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot,
      onStatusChange,
    });

    connection.start();
    await vi.waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith(restSnapshot);
    });

    getLatestSocket()!.simulateOpen();
    getLatestSocket()!.simulateMessage('not-json');
    getLatestSocket()!.simulateMessage(JSON.stringify({ updatedAt: 'bad', coins: {}, fx: {} }));

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onStatusChange).not.toHaveBeenCalledWith('live');
  });

  it('cleans up poll and reconnect timers after disconnect on stop', async () => {
    const fetchFn = vi.fn(async () => Response.json(makeSnapshot(), { status: 200 }));
    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();
    const onStatusChange = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot,
      onStatusChange,
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
    });

    const socket = getLatestSocket()!;
    socket.simulateOpen();
    socket.simulateMessage(JSON.stringify(makeSnapshot()));
    socket.simulateClose();

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    connection.stop();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses polling status before WS has ever delivered a snapshot', async () => {
    const fetchFn = vi.fn(async () => Response.json(makeSnapshot(), { status: 200 }));
    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onStatusChange = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot: vi.fn(),
      onStatusChange,
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
    });

    getLatestSocket()!.simulateClose();

    expect(onStatusChange).toHaveBeenCalledWith('polling');
    expect(onStatusChange).not.toHaveBeenCalledWith('reconnecting');
  });

  it('uses reconnecting status after WS was live and then disconnects', async () => {
    const fetchFn = vi.fn(async () => Response.json(makeSnapshot(), { status: 200 }));
    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onStatusChange = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot: vi.fn(),
      onStatusChange,
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
    });

    getLatestSocket()!.simulateOpen();
    getLatestSocket()!.simulateMessage(JSON.stringify(makeSnapshot()));
    onStatusChange.mockClear();

    getLatestSocket()!.simulateClose();

    expect(onStatusChange).toHaveBeenCalledWith('reconnecting');
    expect(onStatusChange).not.toHaveBeenCalledWith('polling');
  });

  it('backs off reconnect delays exponentially and caps at reconnectMaxMs', async () => {
    const fetchFn = vi.fn(async () => Response.json(makeSnapshot(), { status: 200 }));
    const { WebSocketCtor, getSockets } = createMockWebSocketCtor();
    const reconnectBaseMs = 1_000;
    const reconnectMaxMs = 8_000;

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      reconnectBaseMs,
      reconnectMaxMs,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getSockets()[0]).toBeDefined();
    });

    getSockets()[0]!.simulateClose();
    expect(getSockets()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(reconnectBaseMs);
    expect(getSockets()).toHaveLength(2);

    getSockets()[1]!.simulateClose();
    await vi.advanceTimersByTimeAsync(reconnectBaseMs * 2);
    expect(getSockets()).toHaveLength(3);

    getSockets()[2]!.simulateClose();
    await vi.advanceTimersByTimeAsync(reconnectBaseMs * 4);
    expect(getSockets()).toHaveLength(4);

    getSockets()[3]!.simulateClose();
    await vi.advanceTimersByTimeAsync(reconnectMaxMs);
    expect(getSockets()).toHaveLength(5);

    getSockets()[4]!.simulateClose();
    await vi.advanceTimersByTimeAsync(reconnectMaxMs);
    expect(getSockets()).toHaveLength(6);
  });

  it('resets reconnect backoff after a successful WS message', async () => {
    const fetchFn = vi.fn(async () => Response.json(makeSnapshot(), { status: 200 }));
    const { WebSocketCtor, getSockets } = createMockWebSocketCtor();
    const reconnectBaseMs = 1_000;

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      reconnectBaseMs,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getSockets()[0]).toBeDefined();
    });

    getSockets()[0]!.simulateClose();
    await vi.advanceTimersByTimeAsync(reconnectBaseMs);
    getSockets()[1]!.simulateClose();
    await vi.advanceTimersByTimeAsync(reconnectBaseMs * 2);

    getSockets()[2]!.simulateOpen();
    getSockets()[2]!.simulateMessage(JSON.stringify(makeSnapshot(BASE_TS + 1)));
    getSockets()[2]!.simulateClose();

    const socketsBeforeReconnect = getSockets().length;
    await vi.advanceTimersByTimeAsync(reconnectBaseMs);
    expect(getSockets().length).toBe(socketsBeforeReconnect + 1);
  });

  it('recovers from onerror via close and the same poll + reconnect path as onclose', async () => {
    const fetchFn = vi.fn(async () => Response.json(makeSnapshot(), { status: 200 }));
    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onStatusChange = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot: vi.fn(),
      onStatusChange,
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
    });

    getLatestSocket()!.simulateOpen();
    getLatestSocket()!.simulateMessage(JSON.stringify(makeSnapshot()));
    onStatusChange.mockClear();

    getLatestSocket()!.simulateError();

    expect(getLatestSocket()!.close).toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith('reconnecting');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('continues polling after fetch rejections and non-ok responses', async () => {
    const polledSnapshot = makeSnapshot(BASE_TS + 5_000);
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(Response.json(polledSnapshot, { status: 200 }));

    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();
    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      pollIntervalMs: REST_POLL_INTERVAL_MS,
      onSnapshot,
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
    });

    getLatestSocket()!.simulateClose();

    await vi.advanceTimersByTimeAsync(REST_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(REST_POLL_INTERVAL_MS);

    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onSnapshot).toHaveBeenCalledWith(polledSnapshot);
  });

  it('drops stale REST snapshots that resolve after a newer WS snapshot', async () => {
    const staleSnapshot = makeSnapshot(1_000);
    const freshSnapshot = makeSnapshot(2_000);
    const { fetchFn, resolveNext } = createAbortAwareFetch();
    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot,
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
    });

    getLatestSocket()!.simulateOpen();
    getLatestSocket()!.simulateMessage(JSON.stringify(freshSnapshot));
    await vi.waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith(freshSnapshot);
    });

    resolveNext(Response.json(staleSnapshot, { status: 200 }));
    await drainMicrotasks();

    expect(onSnapshot).not.toHaveBeenCalledWith(staleSnapshot);
    expect(onSnapshot).toHaveBeenLastCalledWith(freshSnapshot);
  });

  it('drops older REST snapshots that resolve after a newer REST snapshot', async () => {
    const staleSnapshot = makeSnapshot(1_000);
    const middleSnapshot = makeSnapshot(2_000);
    const newestSnapshot = makeSnapshot(3_000);
    const pollIntervalMs = 1_000;
    const { fetchFn, resolveAt, getPendingCount } = createAbortIgnoringFetch();
    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      pollIntervalMs,
      reconnectBaseMs: 60_000,
      onSnapshot,
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
      expect(getPendingCount()).toBe(1);
    });

    getLatestSocket()!.simulateClose();
    await vi.advanceTimersByTimeAsync(pollIntervalMs);
    await vi.waitFor(() => {
      expect(getPendingCount()).toBe(3);
    });

    resolveAt(2, Response.json(newestSnapshot, { status: 200 }));
    await vi.waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith(newestSnapshot);
    });

    resolveAt(1, Response.json(middleSnapshot, { status: 200 }));
    resolveAt(0, Response.json(staleSnapshot, { status: 200 }));
    await drainMicrotasks();

    expect(onSnapshot).not.toHaveBeenCalledWith(staleSnapshot);
    expect(onSnapshot).not.toHaveBeenCalledWith(middleSnapshot);
    expect(onSnapshot).toHaveBeenLastCalledWith(newestSnapshot);

    connection.stop();
  });

  it('resets lastAcceptedUpdatedAt so a later start can accept an older snapshot', async () => {
    const newerSnapshot = makeSnapshot(2_000);
    const olderSnapshot = makeSnapshot(1_000);
    const { fetchFn, resolveNext } = createAbortAwareFetch();
    const { WebSocketCtor } = createMockWebSocketCtor();
    const onSnapshot = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      onSnapshot,
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
    resolveNext(Response.json(newerSnapshot, { status: 200 }));
    await vi.waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith(newerSnapshot);
    });

    connection.stop();
    connection.start();
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
    resolveNext(Response.json(olderSnapshot, { status: 200 }));
    await vi.waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith(olderSnapshot);
    });

    expect(onSnapshot).toHaveBeenLastCalledWith(olderSnapshot);
  });

  it('does not emit snapshots after stop while a fetch is in flight', async () => {
    const { fetchFn, resolveNext } = createAbortAwareFetch();
    const onSnapshot = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor: createMockWebSocketCtor().WebSocketCtor,
      onSnapshot,
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    connection.stop();
    resolveNext(Response.json(makeSnapshot(), { status: 200 }));
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it('does not emit a snapshot after stop when fetch ignores abort', async () => {
    const { fetchFn, resolveAt } = createAbortIgnoringFetch();
    const onSnapshot = vi.fn();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor: createMockWebSocketCtor().WebSocketCtor,
      onSnapshot,
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    connection.stop();
    resolveAt(0, Response.json(makeSnapshot(), { status: 200 }));
    await drainMicrotasks();

    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it('aborts a hung fetch when the next poll tick fires', async () => {
    const pollIntervalMs = 1_000;
    const { fetchFn, getPendingCount } = createAbortAwareFetch();
    const onSnapshot = vi.fn();
    const { WebSocketCtor, getLatestSocket } = createMockWebSocketCtor();

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      pollIntervalMs,
      onSnapshot,
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getLatestSocket()).toBeDefined();
    });

    getLatestSocket()!.simulateClose();
    await vi.waitFor(() => {
      expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(getPendingCount()).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(pollIntervalMs);

    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(getPendingCount()).toBeLessThanOrEqual(1);
  });

  it('continues reconnect attempts when the WebSocket constructor throws', async () => {
    let constructCount = 0;
    const fetchFn = vi.fn(async () => Response.json(makeSnapshot(), { status: 200 }));
    const { WebSocketCtor, getSockets } = createMockWebSocketCtor({
      onConstruct: () => {
        constructCount += 1;
        if (constructCount === 2) {
          throw new Error('invalid WebSocket URL');
        }
      },
    });

    const connection = createMarketConnection({
      snapshotUrl: '/api/snapshot',
      wsUrl: 'ws://localhost/ws',
      fetchFn,
      WebSocketCtor,
      reconnectBaseMs: WS_RECONNECT_BASE_MS,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
    });

    connection.start();
    await vi.waitFor(() => {
      expect(getSockets()[0]).toBeDefined();
    });

    getSockets()[0]!.simulateClose();
    await vi.advanceTimersByTimeAsync(WS_RECONNECT_BASE_MS);
    expect(constructCount).toBe(2);

    await vi.advanceTimersByTimeAsync(WS_RECONNECT_BASE_MS * 2);
    expect(getSockets().length).toBeGreaterThanOrEqual(2);
  });
});
