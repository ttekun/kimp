import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BITBANK_INITIAL_BACKOFF_MS,
  BITBANK_MAX_BACKOFF_MS,
  BitbankConnector,
  buildBitbankCircuitBreakRoom,
  buildBitbankJoinRooms,
  buildBitbankTickerRoom,
  type InjectableSocketIoClient,
  type SocketIoClientFactory,
} from '../../src/connectors/bitbank.js';
import { BITBANK_MARKET_CODES, COIN_SYMBOLS } from '../../src/core/symbols.js';
import {
  bitbankRestTickersFixture,
  bitbankWsBtcFixture,
  bitbankWsCircuitBreakActiveFixture,
  bitbankWsCircuitBreakNoneFixture,
  bitbankWsEthFixture,
} from './fixtures/bitbank.js';

class MockSocket extends EventEmitter implements InjectableSocketIoClient {
  connected = false;

  emit(event: 'join-room', room: string): this;
  emit(event: string, ...args: unknown[]): boolean;
  emit(event: string, ...args: unknown[]): this | boolean {
    if (event === 'join-room') {
      super.emit('join-room', ...args);
      return this;
    }

    return super.emit(event, ...args);
  }

  disconnect(): void {
    this.connected = false;
    this.removeAllListeners();
  }
}

function createMockSocketFactory(): {
  factory: SocketIoClientFactory;
  instances: MockSocket[];
} {
  const instances: MockSocket[] = [];

  const factory: SocketIoClientFactory = () => {
    const socket = new MockSocket();
    instances.push(socket);
    return socket;
  };

  return { factory, instances };
}

function createMockFetch(
  responses: Record<string, { body: unknown; ok?: boolean; status?: number }>,
): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    const match = Object.entries(responses).find(([key]) => url.includes(key));
    const {
      body,
      ok = true,
      status = 200,
    } = match?.[1] ?? {
      body: {},
      ok: false,
      status: 404,
    };

    return {
      ok,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  }) as unknown as typeof fetch;
}

const marketStatusFixture = {
  success: 1,
  data: {
    statuses: COIN_SYMBOLS.map((symbol) => ({
      pair: BITBANK_MARKET_CODES[symbol],
      status: 'NORMAL',
      min_amount: '0.0001',
    })),
  },
};

describe('BitbankConnector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits join-room for ticker and circuit_break_info rooms for all five pairs on connect', async () => {
    const { factory, instances } = createMockSocketFactory();
    const emittedRooms: string[] = [];
    const wrappedFactory: SocketIoClientFactory = (url, options) => {
      const socket = factory(url, options);
      const originalEmit = socket.emit.bind(socket);
      socket.emit = ((event: 'join-room', room: string) => {
        if (event === 'join-room') {
          emittedRooms.push(room);
        }
        return originalEmit(event, room);
      }) as InjectableSocketIoClient['emit'];
      return socket;
    };

    const connector = new BitbankConnector({
      socketIoClientFactory: wrappedFactory,
      fetchFn: createMockFetch({
        tickers: { body: bitbankRestTickersFixture },
        status: { body: marketStatusFixture },
      }),
      onTicker: vi.fn(),
    });

    await connector.start();
    instances[0]!.connected = true;
    instances[0]!.emit('connect');

    expect(emittedRooms).toEqual(buildBitbankJoinRooms());
    expect(emittedRooms).toContain(buildBitbankTickerRoom(BITBANK_MARKET_CODES.BTC));
    expect(emittedRooms).toContain(buildBitbankCircuitBreakRoom(BITBANK_MARKET_CODES.DOT));
    expect(buildBitbankJoinRooms()).toHaveLength(COIN_SYMBOLS.length * 2);

    connector.stop();
  });

  it('invokes onTicker when a valid Socket.IO ticker message arrives', async () => {
    const { factory, instances } = createMockSocketFactory();
    const onTicker = vi.fn();
    const connector = new BitbankConnector({
      socketIoClientFactory: factory,
      fetchFn: createMockFetch({
        tickers: { body: { success: 1, data: [] } },
        status: { body: marketStatusFixture },
      }),
      onTicker,
    });

    await connector.start();
    const socket = instances[0]!;
    socket.connected = true;
    socket.emit('connect');
    socket.emit('message', bitbankWsBtcFixture);

    expect(onTicker).toHaveBeenCalledWith('BTC', {
      price: 10_043_108.5,
      ts: 1_786_888_413_333,
      status: 'live',
    });
    expect(connector.getHealth().lastTickAt).toBe(1_786_888_413_333);

    connector.stop();
  });

  it('invokes onBookUnusable for one-sided books without emitting a ticker', async () => {
    const { factory, instances } = createMockSocketFactory();
    const onTicker = vi.fn();
    const onBookUnusable = vi.fn();
    const connector = new BitbankConnector({
      socketIoClientFactory: factory,
      fetchFn: createMockFetch({
        tickers: { body: { success: 1, data: [] } },
        status: { body: marketStatusFixture },
      }),
      onTicker,
      onBookUnusable,
    });

    await connector.start();
    const socket = instances[0]!;
    socket.connected = true;
    socket.emit('connect');
    socket.emit('message', {
      room_name: 'ticker_btc_jpy',
      message: {
        data: {
          ...bitbankWsBtcFixture.message.data,
          sell: '0',
        },
      },
    });

    expect(onTicker).toHaveBeenCalledWith(
      'BTC',
      expect.objectContaining({ unavailable: true, status: 'down' }),
    );
    expect(onBookUnusable).toHaveBeenCalledWith('BTC', 'one_sided');

    connector.stop();
  });

  it('suppresses ticker emission while circuit break mode is active', async () => {
    const { factory, instances } = createMockSocketFactory();
    const onTicker = vi.fn();
    const connector = new BitbankConnector({
      socketIoClientFactory: factory,
      fetchFn: createMockFetch({
        tickers: { body: { success: 1, data: [] } },
        status: { body: marketStatusFixture },
      }),
      onTicker,
    });

    await connector.start();
    const socket = instances[0]!;
    socket.connected = true;
    socket.emit('connect');

    socket.emit('message', bitbankWsCircuitBreakActiveFixture);
    socket.emit('message', {
      room_name: 'ticker_xrp_jpy',
      message: bitbankWsEthFixture.message,
    });

    expect(onTicker).toHaveBeenCalledWith(
      'XRP',
      expect.objectContaining({ unavailable: true, status: 'down' }),
    );
    onTicker.mockClear();
    expect(connector.isCoinSuppressed('XRP')).toBe(true);

    socket.emit('message', bitbankWsEthFixture);
    expect(onTicker).toHaveBeenCalledTimes(1);
    expect(onTicker).toHaveBeenCalledWith('ETH', expect.objectContaining({ price: 299_644.5 }));

    socket.emit('message', bitbankWsCircuitBreakNoneFixture);
    socket.emit('message', bitbankWsBtcFixture);

    expect(onTicker).toHaveBeenCalledTimes(2);
    expect(connector.isCoinSuppressed('BTC')).toBe(false);

    connector.stop();
  });

  it('swallows malformed Socket.IO payloads without invoking callbacks', async () => {
    const { factory, instances } = createMockSocketFactory();
    const onTicker = vi.fn();
    const onMalformedMessage = vi.fn();
    const connector = new BitbankConnector({
      socketIoClientFactory: factory,
      fetchFn: createMockFetch({
        tickers: { body: { success: 1, data: [] } },
        status: { body: marketStatusFixture },
      }),
      onTicker,
      onMalformedMessage,
    });

    await connector.start();
    const socket = instances[0]!;
    socket.connected = true;
    socket.emit('connect');
    socket.emit('message', { nope: true });

    expect(onTicker).not.toHaveBeenCalled();
    expect(onMalformedMessage).toHaveBeenCalled();
    expect(connector.getHealth().status).toBe('connected');

    connector.stop();
  });

  it('schedules reconnect with exponential backoff on disconnect', async () => {
    const { factory, instances } = createMockSocketFactory();
    const connector = new BitbankConnector({
      socketIoClientFactory: factory,
      fetchFn: createMockFetch({
        tickers: { body: { success: 1, data: [] } },
        status: { body: marketStatusFixture },
      }),
      onTicker: vi.fn(),
    });

    await connector.start();
    const socket = instances[0]!;
    socket.connected = true;
    socket.emit('connect');
    socket.emit('disconnect', 'transport close');

    expect(connector.getHealth().status).toBe('disconnected');
    expect(connector.getHealth().reconnectAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(BITBANK_INITIAL_BACKOFF_MS);
    expect(instances).toHaveLength(2);

    instances[1]!.connected = true;
    instances[1]!.emit('disconnect', 'transport close');
    expect(connector.getHealth().reconnectAttempts).toBe(2);

    await vi.advanceTimersByTimeAsync(BITBANK_INITIAL_BACKOFF_MS * 2);
    expect(instances).toHaveLength(3);

    connector.stop();
  });

  it('caps reconnect backoff at 30 seconds', async () => {
    const { factory, instances } = createMockSocketFactory();
    const connector = new BitbankConnector({
      socketIoClientFactory: factory,
      fetchFn: createMockFetch({
        tickers: { body: { success: 1, data: [] } },
        status: { body: marketStatusFixture },
      }),
      onTicker: vi.fn(),
    });

    await connector.start();

    let expectedDelay = BITBANK_INITIAL_BACKOFF_MS;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const socket = instances.at(-1)!;
      socket.connected = true;
      socket.emit('connect');
      socket.emit('disconnect', 'transport close');
      expect(connector.getHealth().reconnectAttempts).toBe(attempt + 1);

      await vi.advanceTimersByTimeAsync(expectedDelay);
      expectedDelay = Math.min(expectedDelay * 2, BITBANK_MAX_BACKOFF_MS);
    }

    const socket = instances.at(-1)!;
    socket.connected = true;
    socket.emit('connect');
    socket.emit('disconnect', 'transport close');
    const beforeAttempts = connector.getHealth().reconnectAttempts;
    await vi.advanceTimersByTimeAsync(BITBANK_MAX_BACKOFF_MS);
    expect(instances.length).toBeGreaterThan(beforeAttempts);

    connector.stop();
  });

  it('increments reconnectAttempts once when connect_error and disconnect fire for the same socket', async () => {
    const { factory, instances } = createMockSocketFactory();
    const connector = new BitbankConnector({
      socketIoClientFactory: factory,
      fetchFn: createMockFetch({
        tickers: { body: { success: 1, data: [] } },
        status: { body: marketStatusFixture },
      }),
      onTicker: vi.fn(),
    });

    await connector.start();
    const socket = instances[0]!;
    socket.connected = true;
    socket.emit('connect_error', new Error('socket hang up'));
    socket.emit('disconnect', 'transport error');

    expect(connector.getHealth().reconnectAttempts).toBe(1);
    expect(connector.getHealth().status).toBe('disconnected');

    await vi.advanceTimersByTimeAsync(BITBANK_INITIAL_BACKOFF_MS);
    expect(instances).toHaveLength(2);

    connector.stop();
  });

  it('bootstraps tickers from REST batch /tickers via injected fetch', async () => {
    const onTicker = vi.fn();
    const connector = new BitbankConnector({
      socketIoClientFactory: createMockSocketFactory().factory,
      fetchFn: createMockFetch({
        tickers: { body: bitbankRestTickersFixture },
        status: { body: marketStatusFixture },
      }),
      onTicker,
    });

    await connector.bootstrapFromRest();

    expect(onTicker).toHaveBeenCalledTimes(COIN_SYMBOLS.length);
    expect(onTicker).toHaveBeenCalledWith('BTC', expect.objectContaining({ price: 10_043_108.5 }));
    expect(onTicker).toHaveBeenCalledWith('DOGE', expect.objectContaining({ price: 13.4025 }));

    connector.stop();
  });

  it('records REST HTTP failures without throwing and still opens Socket.IO on start', async () => {
    const { factory, instances } = createMockSocketFactory();
    const connector = new BitbankConnector({
      socketIoClientFactory: factory,
      fetchFn: createMockFetch({
        tickers: { body: {}, ok: false, status: 429 },
        status: { body: {}, ok: false, status: 429 },
      }),
      onTicker: vi.fn(),
    });

    await connector.start();

    expect(connector.getHealth().lastError?.kind).toBe('http_error');
    expect(instances).toHaveLength(1);

    connector.stop();
  });

  it('records REST fetch rejection and still opens Socket.IO on start', async () => {
    const { factory, instances } = createMockSocketFactory();
    const fetchFn = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND public.bitbank.cc');
    }) as unknown as typeof fetch;

    const connector = new BitbankConnector({
      socketIoClientFactory: factory,
      fetchFn,
      onTicker: vi.fn(),
    });

    await connector.start();

    expect(connector.getHealth().lastError?.kind).toBe('dns_tls');
    expect(instances).toHaveLength(1);

    connector.stop();
  });
});
