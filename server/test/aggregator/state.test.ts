import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAggregatorSnapshotStore } from '../../src/aggregator/state.js';
import { STALENESS_THRESHOLDS } from '../../src/core/snapshot.js';
import type { BinanceTicker, Rate, UpbitTicker } from '../../src/core/types.js';

const BASE_TS = 1_000_000;
const USD_KRW = 1414.86;
const USD_JPY = 159.23;

function makeRate(fetchedAt: number, overrides: Partial<Rate> = {}): Rate {
  return {
    value: USD_KRW,
    fetchedAt,
    source: 'er-api',
    ratesDate: '2026-08-16',
    ...overrides,
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

afterEach(() => {
  vi.useRealTimers();
});

describe('createAggregatorSnapshotStore read-time staleness decay', () => {
  it('decays ticker statuses and premiums on getSnapshot without further merges', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);

    const store = createAggregatorSnapshotStore(BASE_TS);
    store.onFxRates({
      usdKrw: makeRate(BASE_TS),
      usdJpy: makeRate(BASE_TS, { value: USD_JPY }),
    });
    store.onUpbitTicker('BTC', makeUpbit(BASE_TS));
    store.onBinanceTicker('BTC', makeBinance(BASE_TS));

    expect(store.getSnapshot().coins.BTC.upbit?.status).toBe('live');
    expect(store.getSnapshot().coins.BTC.binance?.status).toBe('live');
    expect(store.getSnapshot().coins.BTC.premiumBinance?.status).toBe('live');

    vi.setSystemTime(BASE_TS + STALENESS_THRESHOLDS.upbit.staleAfterMs + 1);

    expect(store.getSnapshot().coins.BTC.upbit?.status).toBe('stale');
    expect(store.getSnapshot().coins.BTC.binance?.status).toBe('stale');
    expect(store.getSnapshot().coins.BTC.premiumBinance?.status).toBe('stale');

    vi.setSystemTime(BASE_TS + STALENESS_THRESHOLDS.upbit.downAfterMs + 1);

    expect(store.getSnapshot().coins.BTC.upbit?.status).toBe('down');
    expect(store.getSnapshot().coins.BTC.binance?.status).toBe('down');
    expect(store.getSnapshot().coins.BTC.premiumBinance).toBeUndefined();
  });
});
