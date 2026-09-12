import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAggregatorSnapshotStore, getAggregatorHealth } from '../../src/aggregator/state.js';
import {
  UpbitConnector,
  type InjectableWebSocket,
  type WebSocketCtor,
} from '../../src/connectors/upbit.js';
import { FxPoller, ER_API_URL, FRANKFURTER_URL } from '../../src/connectors/fx.js';
import { COIN_SYMBOLS } from '../../src/core/symbols.js';
import { STALENESS_THRESHOLDS } from '../../src/core/snapshot.js';
import type { BinanceTicker, BitbankTicker, Rate, UpbitTicker } from '../../src/core/types.js';
import {
  applyAgedFx,
  applyClockSkew,
  registerFaultInjectionRoutes,
} from '../../src/transport/faultInjection.js';
import { buildHttpApi } from '../../src/transport/httpApi.js';
import { upbitWsBtcFixture } from '../connectors/fixtures/upbit.js';
import { frankfurterFixture } from '../connectors/fixtures/fx.js';

const BASE_TS = 1_700_000_000_000;
const USD_KRW = 1414.86;
const USD_JPY = 159.23;

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) =>
        import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true })),
      ),
  );
});

async function createStaticFixture(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `kimchi-fault-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><html><body>fixture</body></html>',
    'utf8',
  );
  tempDirs.push(dir);
  return dir;
}

function makeRate(fetchedAt: number, overrides: Partial<Rate> = {}): Rate {
  return {
    value: USD_KRW,
    fetchedAt,
    source: 'er-api',
    ratesDate: '2026-08-16',
    ...overrides,
  };
}

function makeUpbit(ts: number): UpbitTicker {
  return {
    price: 148_500_000,
    change24hPct: 0,
    volume24hKrw: 1e11,
    ts,
    status: 'live',
  };
}

function makeBinance(ts: number): BinanceTicker {
  return { price: 104_250.5, ts, status: 'live' };
}

function makeBitbank(ts: number): BitbankTicker {
  return { price: 16_500_000, ts, status: 'live' };
}

function seedLive(store: ReturnType<typeof createAggregatorSnapshotStore>, now: number): void {
  store.onFxRates({
    usdKrw: makeRate(now),
    usdJpy: makeRate(now, { value: USD_JPY }),
  });
  for (const coin of COIN_SYMBOLS) {
    store.onUpbitTicker(coin, makeUpbit(now));
    store.onBinanceTicker(coin, makeBinance(now));
    store.onBitbankTicker(coin, makeBitbank(now));
  }
}

function refreshFeeds(
  store: ReturnType<typeof createAggregatorSnapshotStore>,
  now: number,
  feeds: { upbit?: boolean; binance?: boolean; bitbank?: boolean },
): void {
  for (const coin of COIN_SYMBOLS) {
    if (feeds.upbit) {
      store.onUpbitTicker(coin, makeUpbit(now));
    }
    if (feeds.binance) {
      store.onBinanceTicker(coin, makeBinance(now));
    }
    if (feeds.bitbank) {
      store.onBitbankTicker(coin, makeBitbank(now));
    }
  }
}

class MockWebSocket extends EventEmitter implements InjectableWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  constructor(public readonly url: string) {
    super();
  }
  send(data: string): void {
    this.sent.push(data);
  }
  ping(): void {}
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
}

function createMockWebSocketFactory(): { ctor: WebSocketCtor; instances: MockWebSocket[] } {
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

describe('fault injection — snapshot invariant via store + HTTP', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);
  });

  it('killing Upbit (no further ticks) omits both pair premiums while overseas prices remain', async () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    seedLive(store, BASE_TS);

    vi.setSystemTime(BASE_TS + STALENESS_THRESHOLDS.upbit.downAfterMs + 1);
    refreshFeeds(store, Date.now(), { binance: true, bitbank: true });

    const snapshot = store.getSnapshot();
    expect(snapshot.coins.BTC.upbit?.status).toBe('down');
    expect(snapshot.coins.BTC.binance?.status).toBe('live');
    expect(snapshot.coins.BTC.bitbank?.status).toBe('live');
    expect(snapshot.coins.BTC.premiumBinance).toBeUndefined();
    expect(snapshot.coins.BTC.premiumBitbank).toBeUndefined();
    expect(snapshot.coins.BTC.binance?.price).toBe(104_250.5);
    expect(snapshot.coins.BTC.bitbank?.price).toBe(16_500_000);

    const app = await buildHttpApi({
      getSnapshot: () => store.getSnapshot(),
      getHealth: () => ({
        ok: false,
        connectors: {
          upbit: { status: 'down', lastTickAgeMs: 60_001, reconnects: 0, lastError: null },
          binance: { status: 'live', lastTickAgeMs: 0, reconnects: 0, lastError: null },
          bitbank: { status: 'live', lastTickAgeMs: 0, reconnects: 0, lastError: null },
          fx: { status: 'live', lastTickAgeMs: 60_001, reconnects: 0, lastError: null },
        },
      }),
      staticRoot: await createStaticFixture(),
    });

    const response = await app.inject({ method: 'GET', url: '/api/snapshot' });
    const body = JSON.parse(response.body) as typeof snapshot;
    expect(body.coins.BTC.premiumBinance).toBeUndefined();
    expect(body.coins.BTC.premiumBitbank).toBeUndefined();
    await app.close();
  });

  it('killing Binance omits Pair A only; Pair B stays live', () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    seedLive(store, BASE_TS);

    vi.setSystemTime(BASE_TS + STALENESS_THRESHOLDS.binance.downAfterMs + 1);
    refreshFeeds(store, Date.now(), { upbit: true, bitbank: true });

    const snapshot = store.getSnapshot();
    expect(snapshot.coins.BTC.binance?.status).toBe('down');
    expect(snapshot.coins.BTC.upbit?.status).toBe('live');
    expect(snapshot.coins.BTC.bitbank?.status).toBe('live');
    expect(snapshot.coins.BTC.premiumBinance).toBeUndefined();
    expect(snapshot.coins.BTC.premiumBitbank?.status).toBe('live');
    expect(snapshot.coins.BTC.premiumBitbank?.pct).toBeTypeOf('number');
  });

  it('killing Bitbank omits Pair B only; Pair A stays live', () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    seedLive(store, BASE_TS);

    vi.setSystemTime(BASE_TS + STALENESS_THRESHOLDS.bitbank.downAfterMs + 1);
    refreshFeeds(store, Date.now(), { upbit: true, binance: true });

    const snapshot = store.getSnapshot();
    expect(snapshot.coins.BTC.bitbank?.status).toBe('down');
    expect(snapshot.coins.BTC.premiumBitbank).toBeUndefined();
    expect(snapshot.coins.BTC.premiumBinance?.status).toBe('live');
  });

  it('throttling a feed into the stale window keeps a computed premium (not omitted)', () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    seedLive(store, BASE_TS);

    vi.setSystemTime(BASE_TS + STALENESS_THRESHOLDS.upbit.staleAfterMs + 1);
    refreshFeeds(store, Date.now(), { binance: true, bitbank: true });

    const snapshot = store.getSnapshot();
    expect(snapshot.coins.BTC.upbit?.status).toBe('stale');
    expect(snapshot.coins.BTC.premiumBinance?.status).toBe('stale');
    expect(snapshot.coins.BTC.premiumBinance?.pct).toBeTypeOf('number');
    expect(snapshot.coins.BTC.premiumBitbank?.status).toBe('stale');
  });

  it('aging FX past 26h marks premiums stale; past 78h omits them (no 26h wall-clock wait)', () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    seedLive(store, BASE_TS);
    const fxStub = { stop: vi.fn() };

    applyAgedFx(store, { fx: fxStub } as never, STALENESS_THRESHOLDS.fx.staleAfterMs + 1);
    refreshFeeds(store, Date.now(), { upbit: true, binance: true, bitbank: true });

    let snapshot = store.getSnapshot();
    expect(snapshot.coins.BTC.premiumBinance?.status).toBe('stale');
    expect(snapshot.coins.BTC.premiumBinance).toBeDefined();
    expect(fxStub.stop).toHaveBeenCalled();

    applyAgedFx(store, { fx: fxStub } as never, STALENESS_THRESHOLDS.fx.downAfterMs + 1);
    refreshFeeds(store, Date.now(), { upbit: true, binance: true, bitbank: true });
    snapshot = store.getSnapshot();
    expect(snapshot.coins.BTC.premiumBinance).toBeUndefined();
    expect(snapshot.coins.BTC.premiumBitbank).toBeUndefined();
  });

  it('clock skew > 30s marks premiums stale without omitting (both legs still live)', () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    seedLive(store, BASE_TS);
    applyClockSkew(store, 'BTC');

    const snapshot = store.getSnapshot();
    expect(snapshot.coins.BTC.upbit?.status).toBe('live');
    expect(snapshot.coins.BTC.binance?.status).toBe('live');
    expect(snapshot.coins.BTC.bitbank?.status).toBe('live');
    expect(snapshot.coins.BTC.premiumBinance?.status).toBe('stale');
    expect(snapshot.coins.BTC.premiumBitbank?.status).toBe('stale');
    expect(snapshot.coins.BTC.premiumBinance?.pct).toBeTypeOf('number');
  });
});

describe('fault injection — connector 429 / malformed into aggregator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);
  });

  it('REST 429 is non-fatal: WS still connects and health records HTTP 429', async () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch({}, { ok: false, status: 429 }),
      onTicker: store.onUpbitTicker,
      onUsdtRate: store.onUpbitUsdtRate,
    });

    await connector.start();
    expect(connector.getHealth().lastError?.message).toContain('HTTP 429');
    expect(connector.getHealth().status).not.toBe('connected');

    instances[0]?.simulateOpen();
    expect(connector.getHealth().status).toBe('connected');

    const healthWhileRateLimited = getAggregatorHealth(
      {
        upbit: {
          getHealth: () => ({
            status: 'connecting',
            reconnectAttempts: 0,
            lastTickAt: null,
            lastError: { kind: 'http_error', message: 'HTTP 429: ', at: BASE_TS },
          }),
        },
        binance: {
          getHealth: () => ({
            status: 'connected',
            reconnectAttempts: 0,
            lastTickAt: BASE_TS,
            lastError: null,
          }),
        },
        bitbank: {
          getHealth: () => ({
            status: 'connected',
            reconnectAttempts: 0,
            lastTickAt: BASE_TS,
            lastError: null,
          }),
        },
        fx: {
          getHealth: () => ({
            status: 'ok',
            lastError: null,
            lastSuccessfulFetchAt: { erApi: BASE_TS, frankfurter: BASE_TS },
            lastDivergenceCheck: null,
            timeEolDetected: false,
            timeEolUnix: null,
            fetchCountToday: 1,
            totalFetches: 1,
          }),
        },
      } as never,
      BASE_TS,
    );
    expect(healthWhileRateLimited.connectors.upbit.lastError).toContain('HTTP 429');

    connector.stop();
  });

  it('malformed WS payload does not crash, records lastError, and does not overwrite last-good price', async () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    seedLive(store, BASE_TS);
    const { ctor, instances } = createMockWebSocketFactory();
    const connector = new UpbitConnector({
      WebSocketCtor: ctor,
      fetchFn: createMockFetch([]),
      onTicker: store.onUpbitTicker,
      onUsdtRate: store.onUpbitUsdtRate,
    });

    await connector.start();
    instances[0]?.simulateOpen();

    const liveTick = {
      ...upbitWsBtcFixture,
      timestamp: BASE_TS,
      trade_timestamp: BASE_TS,
    };
    connector.ingestRawMessage(Buffer.from(JSON.stringify(liveTick)));
    const priceAfterGood = store.getSnapshot().coins.BTC.upbit?.price;

    connector.ingestRawMessage(Buffer.from('not-json{{{'));
    expect(connector.getHealth().lastError?.kind).toBe('malformed_payload');
    expect(store.getSnapshot().coins.BTC.upbit?.price).toBe(priceAfterGood);
    expect(store.getSnapshot().coins.BTC.upbit?.status).not.toBe('down');

    vi.setSystemTime(BASE_TS + STALENESS_THRESHOLDS.upbit.downAfterMs + 1);
    refreshFeeds(store, Date.now(), { binance: true, bitbank: true });
    expect(store.getSnapshot().coins.BTC.premiumBinance).toBeUndefined();

    connector.stop();
  });

  it('FX 429 is classified rate_limited and does not throw (poller test double, no real primary)', async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === ER_API_URL) {
        return {
          ok: false,
          status: 429,
          json: async () => ({}),
          text: async () => 'too many requests',
        };
      }
      if (url === FRANKFURTER_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => frankfurterFixture,
          text: async () => JSON.stringify(frankfurterFixture),
        };
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const poller = new FxPoller({ fetchFn, now: () => Date.now(), onRates: vi.fn() });
    await poller.start();

    expect(poller.getHealth().lastError?.kind).toBe('rate_limited');
    poller.stop();
  });
});

describe('POST /api/dev/fault', () => {
  it('is absent unless extra routes are registered', async () => {
    const store = createAggregatorSnapshotStore(BASE_TS);
    const app = await buildHttpApi({
      getSnapshot: () => store.getSnapshot(),
      getHealth: () => ({
        ok: true,
        connectors: {
          upbit: { status: 'live', lastTickAgeMs: 1, reconnects: 0, lastError: null },
          binance: { status: 'live', lastTickAgeMs: 1, reconnects: 0, lastError: null },
          bitbank: { status: 'live', lastTickAgeMs: 1, reconnects: 0, lastError: null },
          fx: { status: 'live', lastTickAgeMs: 1, reconnects: 0, lastError: null },
        },
      }),
      staticRoot: await createStaticFixture(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/dev/fault',
      payload: { action: 'kill', feed: 'upbit' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('kill/malformed/skew/age-fx operate on injected connectors and store', async () => {
    const now = Date.now();
    const store = createAggregatorSnapshotStore(now);
    seedLive(store, now);

    const upbit = {
      stop: vi.fn(),
      start: vi.fn(async () => undefined),
      ingestRawMessage: vi.fn(),
      getHealth: () => ({
        status: 'connected' as const,
        reconnectAttempts: 0,
        lastTickAt: now,
        lastError: null,
      }),
    };
    const binance = {
      stop: vi.fn(),
      start: vi.fn(async () => undefined),
      getHealth: upbit.getHealth,
    };
    const bitbank = {
      stop: vi.fn(),
      start: vi.fn(async () => undefined),
      getHealth: upbit.getHealth,
    };
    const fx = {
      stop: vi.fn(),
      start: vi.fn(async () => undefined),
      getHealth: () => ({
        status: 'ok' as const,
        lastError: null,
        lastSuccessfulFetchAt: { erApi: now, frankfurter: now },
        lastDivergenceCheck: null,
        timeEolDetected: false,
        timeEolUnix: null,
        fetchCountToday: 1,
        totalFetches: 1,
      }),
    };

    const app = await buildHttpApi({
      getSnapshot: () => store.getSnapshot(),
      getHealth: () => getAggregatorHealth({ upbit, binance, bitbank, fx } as never, Date.now()),
      staticRoot: await createStaticFixture(),
      registerExtraRoutes: (instance) => {
        registerFaultInjectionRoutes(instance, {
          connectors: { upbit, binance, bitbank, fx } as never,
          store,
        });
      },
    });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/dev/fault',
          payload: { action: 'kill', feed: 'upbit' },
        })
      ).statusCode,
    ).toBe(200);
    expect(upbit.stop).toHaveBeenCalled();

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/dev/fault',
          payload: { action: 'malformed', feed: 'upbit' },
        })
      ).statusCode,
    ).toBe(200);
    expect(upbit.ingestRawMessage).toHaveBeenCalled();

    const skew = await app.inject({
      method: 'POST',
      url: '/api/dev/fault',
      payload: { action: 'skew', coin: 'BTC' },
    });
    expect(skew.statusCode).toBe(200);
    expect(store.getSnapshot().coins.BTC.premiumBinance?.status).toBe('stale');

    const aged = await app.inject({
      method: 'POST',
      url: '/api/dev/fault',
      payload: { action: 'age-fx', ageMs: STALENESS_THRESHOLDS.fx.staleAfterMs + 1 },
    });
    expect(aged.statusCode).toBe(200);
    expect(fx.stop).toHaveBeenCalled();
    refreshFeeds(store, Date.now(), { upbit: true, binance: true, bitbank: true });
    expect(store.getSnapshot().coins.BTC.premiumBinance?.status).toBe('stale');

    await app.close();
  });
});
