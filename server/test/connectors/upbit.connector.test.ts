import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UPBIT_INITIAL_BACKOFF_MS,
  UPBIT_MAX_BACKOFF_MS,
  UPBIT_PING_INTERVAL_MS,
  UPBIT_SUBSCRIBE_CODES,
  UpbitConnector,
  type InjectableWebSocket,
  type WebSocketCtor,
} from '../../src/connectors/upbit.js';
import { upbitRestFixture, upbitWsBtcFixture } from './fixtures/upbit.js';

class MockWebSocket extends EventEmitter implements InjectableWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  pingCount = 0;

  constructor(public readonly url: string) {
    super();
  }

  send(data: string): void {
    this.sent.push(data);
  }

  ping(): void {
    this.pingCount += 1;
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

describe('UpbitConnector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends subscribe payload with all six market codes on open', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();

    expect(instances[0]?.sent).toHaveLength(1);
    const subscribe = JSON.parse(instances[0]!.sent[0]!) as unknown[];

    expect(subscribe[1]).toEqual({ type: 'ticker', codes: [...UPBIT_SUBSCRIBE_CODES] });
    expect((subscribe[1] as { codes: string[] }).codes).toHaveLength(7);
    expect((subscribe[1] as { codes: string[] }).codes).toContain('KRW-USDT');

    connector.stop();
  });

  it('invokes onTicker when a valid WS message arrives', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const onTicker = vi.fn();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker,
      onUsdtRate: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();
    instances[0]?.simulateMessage(upbitWsBtcFixture);

    expect(onTicker).toHaveBeenCalledWith('BTC', {
      price: 89_167_000,
      change24hPct: -0.08851937,
      volume24hKrw: 14_828_736_024.7666,
      ts: 1_786_885_305_230,
      status: 'live',
    });
    expect(connector.getHealth().lastTickAt).toBe(1_786_885_305_230);

    connector.stop();
  });

  it('swallows malformed WS payloads without invoking callbacks', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const onTicker = vi.fn();
    const onMalformedMessage = vi.fn();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker,
      onUsdtRate: vi.fn(),
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

  it('classifies negative acc_trade_price_24h as malformed and keeps processing valid messages', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const onTicker = vi.fn();
    const onMalformedMessage = vi.fn();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker,
      onUsdtRate: vi.fn(),
      onMalformedMessage,
    });

    await connector.start();
    instances[0]?.simulateOpen();

    instances[0]?.simulateMessage({
      type: 'ticker',
      code: 'KRW-BTC',
      trade_price: 89_167_000,
      signed_change_rate: -0.0008851937,
      acc_trade_price_24h: -1,
      timestamp: 1_786_885_305_230,
      trade_date: '20260816',
    });

    expect(onTicker).not.toHaveBeenCalled();
    expect(onMalformedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'malformed_payload' }),
    );
    expect(connector.getHealth().status).toBe('connected');

    instances[0]?.simulateMessage(upbitWsBtcFixture);

    expect(onTicker).toHaveBeenCalledTimes(1);
    expect(connector.getHealth().lastTickAt).toBe(1_786_885_305_230);

    connector.stop();
  });

  it('schedules reconnect with exponential backoff on close', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();
    instances[0]?.simulateClose();

    expect(connector.getHealth().status).toBe('disconnected');
    expect(connector.getHealth().reconnectAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(UPBIT_INITIAL_BACKOFF_MS);
    expect(instances).toHaveLength(2);

    instances[1]?.simulateClose();
    expect(connector.getHealth().reconnectAttempts).toBe(2);

    await vi.advanceTimersByTimeAsync(UPBIT_INITIAL_BACKOFF_MS * 2);
    expect(instances).toHaveLength(3);

    connector.stop();
  });

  it('caps reconnect backoff at 30 seconds', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
    });

    await connector.start();

    let expectedDelay = UPBIT_INITIAL_BACKOFF_MS;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      instances.at(-1)?.simulateClose();
      expect(connector.getHealth().reconnectAttempts).toBe(attempt + 1);

      await vi.advanceTimersByTimeAsync(expectedDelay);
      expectedDelay = Math.min(expectedDelay * 2, UPBIT_MAX_BACKOFF_MS);
    }

    instances.at(-1)?.simulateClose();
    const beforeAttempts = connector.getHealth().reconnectAttempts;
    await vi.advanceTimersByTimeAsync(UPBIT_MAX_BACKOFF_MS);
    expect(instances.length).toBeGreaterThan(beforeAttempts);

    connector.stop();
  });

  it('records network errors and reconnects after WS error', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();
    instances[0]?.simulateError('getaddrinfo ENOTFOUND api.upbit.com');

    expect(connector.getHealth().lastError?.kind).toBe('dns_tls');

    await vi.advanceTimersByTimeAsync(UPBIT_INITIAL_BACKOFF_MS);
    expect(instances).toHaveLength(2);

    connector.stop();
  });

  it('increments reconnectAttempts once when error and close fire for the same socket', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();

    instances[0]?.simulateErrorThenClose('socket hang up');

    expect(connector.getHealth().reconnectAttempts).toBe(1);
    expect(connector.getHealth().status).toBe('disconnected');

    await vi.advanceTimersByTimeAsync(UPBIT_INITIAL_BACKOFF_MS);
    expect(instances).toHaveLength(2);

    connector.stop();
  });

  it('sends periodic ping frames for heartbeat', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
    });

    await connector.start();
    instances[0]?.simulateOpen();

    expect(instances[0]?.pingCount).toBe(0);
    await vi.advanceTimersByTimeAsync(UPBIT_PING_INTERVAL_MS);
    expect(instances[0]?.pingCount).toBe(1);

    connector.stop();
  });

  it('bootstraps tickers from REST via injected fetch', async () => {
    const onTicker = vi.fn();
    const onUsdtRate = vi.fn();
    const connector = new UpbitConnector({
      WebSocketCtor: createMockWebSocketFactory().ctor,
      fetchFn: createMockFetch([upbitRestFixture[0]]),
      onTicker,
      onUsdtRate,
    });

    await connector.bootstrapFromRest();

    expect(onTicker).toHaveBeenCalledTimes(1);
    expect(onTicker).toHaveBeenCalledWith('BTC', expect.objectContaining({ price: 89_167_000 }));
    expect(onUsdtRate).not.toHaveBeenCalled();

    connector.stop();
  });

  it('records REST HTTP failures without throwing and still opens WS on start', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch({}, { ok: false, status: 429 }),
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
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

    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn,
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
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

    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn,
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
    });

    await connector.start();

    expect(connector.getHealth().lastError?.kind).toBe('malformed_payload');
    expect(instances).toHaveLength(1);

    connector.stop();
  });

  it('records REST fetch rejection and still opens WS on start', async () => {
    const { ctor, instances } = createMockWebSocketFactory();
    const fetchFn = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.upbit.com');
    }) as unknown as typeof fetch;

    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn,
      onTicker: vi.fn(),
      onUsdtRate: vi.fn(),
    });

    await connector.start();

    expect(connector.getHealth().lastError?.kind).toBe('dns_tls');
    expect(instances).toHaveLength(1);

    connector.stop();
  });
});
