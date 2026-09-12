import { describe, expect, it } from 'vitest';

import {
  createEmptySnapshot,
  deriveFeedStatus,
  mergeFxRate,
  mergeTicker,
  recomputeSnapshot,
  STALENESS_THRESHOLDS,
} from '../../src/core/snapshot.js';
import { COIN_SYMBOLS } from '../../src/core/symbols.js';
import type { BinanceTicker, MarketSnapshot, Rate, UpbitTicker } from '../../src/core/types.js';

const BASE_TS = 1_000_000;
const HOUR_MS = 60 * 60 * 1000;

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

function seedBtcSnapshot(
  now: number,
  options: { upbitTs?: number; binanceTs?: number } = {},
): MarketSnapshot {
  const upbitTs = options.upbitTs ?? now;
  const binanceTs = options.binanceTs ?? now;

  let snapshot = createEmptySnapshot(now);
  snapshot = mergeFxRate(snapshot, 'usdKrw', makeRate(BASE_TS), now);
  snapshot = mergeFxRate(snapshot, 'usdJpy', makeRate(BASE_TS, { value: USD_JPY }), now);
  snapshot = mergeTicker(snapshot, 'upbit', 'BTC', makeUpbit(upbitTs), now);
  snapshot = mergeTicker(snapshot, 'binance', 'BTC', makeBinance(binanceTs), now);
  return snapshot;
}

describe('STALENESS_THRESHOLDS', () => {
  it('matches docs/02-architecture.md table values', () => {
    expect(STALENESS_THRESHOLDS.upbit).toEqual({ staleAfterMs: 15_000, downAfterMs: 60_000 });
    expect(STALENESS_THRESHOLDS.binance).toEqual({ staleAfterMs: 15_000, downAfterMs: 60_000 });
    expect(STALENESS_THRESHOLDS.bitbank).toEqual({ staleAfterMs: 30_000, downAfterMs: 120_000 });
    expect(STALENESS_THRESHOLDS.fx).toEqual({
      staleAfterMs: 26 * HOUR_MS,
      downAfterMs: 78 * HOUR_MS,
    });
    expect(STALENESS_THRESHOLDS.crossExchangeSkew).toEqual({ maxSkewMs: 30_000 });
  });
});

describe('deriveFeedStatus', () => {
  it('returns live when age is within the stale threshold', () => {
    expect(deriveFeedStatus(BASE_TS, BASE_TS, 15_000, 60_000)).toBe('live');
    expect(deriveFeedStatus(BASE_TS, BASE_TS + 15_000, 15_000, 60_000)).toBe('live');
  });

  it('returns stale when age exceeds stale but not down threshold', () => {
    expect(deriveFeedStatus(BASE_TS, BASE_TS + 15_001, 15_000, 60_000)).toBe('stale');
    expect(deriveFeedStatus(BASE_TS, BASE_TS + 60_000, 15_000, 60_000)).toBe('stale');
  });

  it('returns down when age exceeds the down threshold', () => {
    expect(deriveFeedStatus(BASE_TS, BASE_TS + 60_001, 15_000, 60_000)).toBe('down');
  });
});

describe('createEmptySnapshot', () => {
  it('includes all coin keys with empty coin snapshots', () => {
    const snapshot = createEmptySnapshot(BASE_TS);

    expect(COIN_SYMBOLS.every((symbol) => symbol in snapshot.coins)).toBe(true);
    expect(Object.keys(snapshot.coins)).toHaveLength(COIN_SYMBOLS.length);

    for (const symbol of COIN_SYMBOLS) {
      const coin = snapshot.coins[symbol];
      expect(coin.upbit).toBeUndefined();
      expect(coin.binance).toBeUndefined();
      expect(coin.bitbank).toBeUndefined();
      expect(coin.premiumBinance).toBeUndefined();
      expect(coin.premiumBitbank).toBeUndefined();
    }

    expect(snapshot.fx.usdKrw).toBeUndefined();
    expect(snapshot.fx.usdJpy).toBeUndefined();
    expect(snapshot.fx.krwPerJpy).toBeUndefined();
    expect(snapshot.updatedAt).toBe(BASE_TS);
  });
});

describe('mergeTicker staleness transitions', () => {
  it('marks an upbit ticker live -> stale when age crosses 15s', () => {
    const freshNow = BASE_TS;
    const staleNow = BASE_TS + STALENESS_THRESHOLDS.upbit.staleAfterMs + 1;

    let snapshot = createEmptySnapshot(freshNow);
    snapshot = mergeTicker(snapshot, 'upbit', 'BTC', makeUpbit(BASE_TS), freshNow);
    expect(snapshot.coins.BTC.upbit?.status).toBe('live');

    snapshot = mergeTicker(snapshot, 'upbit', 'BTC', makeUpbit(BASE_TS), staleNow);
    expect(snapshot.coins.BTC.upbit?.status).toBe('stale');
  });

  it('marks an upbit ticker stale -> down when age crosses 60s', () => {
    const staleNow = BASE_TS + STALENESS_THRESHOLDS.upbit.staleAfterMs + 1;
    const downNow = BASE_TS + STALENESS_THRESHOLDS.upbit.downAfterMs + 1;

    let snapshot = createEmptySnapshot(staleNow);
    snapshot = mergeTicker(snapshot, 'upbit', 'BTC', makeUpbit(BASE_TS), staleNow);
    expect(snapshot.coins.BTC.upbit?.status).toBe('stale');

    snapshot = mergeTicker(snapshot, 'upbit', 'BTC', makeUpbit(BASE_TS), downNow);
    expect(snapshot.coins.BTC.upbit?.status).toBe('down');
  });

  it('rejects a delayed older ticker without rolling back the accepted price', () => {
    const newerTs = BASE_TS + 2_000;
    const olderTs = BASE_TS + 1_000;
    let snapshot = createEmptySnapshot(newerTs);

    snapshot = mergeTicker(
      snapshot,
      'upbit',
      'BTC',
      makeUpbit(newerTs, { price: 150_000_000 }),
      newerTs,
    );
    snapshot = mergeTicker(snapshot, 'upbit', 'BTC', makeUpbit(olderTs, { price: 1 }), newerTs);

    expect(snapshot.coins.BTC.upbit).toMatchObject({ ts: newerTs, price: 150_000_000 });
  });
});

describe('mergeFxRate staleness transitions', () => {
  it('marks FX live -> stale at 26h and stale -> down at 78h', () => {
    const fxFetchedAt = BASE_TS;
    const liveNow = fxFetchedAt + STALENESS_THRESHOLDS.fx.staleAfterMs;
    const staleNow = fxFetchedAt + STALENESS_THRESHOLDS.fx.staleAfterMs + 1;
    const downNow = fxFetchedAt + STALENESS_THRESHOLDS.fx.downAfterMs + 1;

    let snapshot = createEmptySnapshot(liveNow);
    snapshot = mergeFxRate(snapshot, 'usdKrw', makeRate(fxFetchedAt), liveNow);
    snapshot = mergeFxRate(snapshot, 'usdJpy', makeRate(fxFetchedAt, { value: USD_JPY }), liveNow);
    snapshot = mergeTicker(snapshot, 'upbit', 'BTC', makeUpbit(liveNow), liveNow);
    snapshot = mergeTicker(snapshot, 'binance', 'BTC', makeBinance(liveNow), liveNow);
    expect(snapshot.coins.BTC.premiumBinance?.status).toBe('live');

    snapshot = mergeFxRate(snapshot, 'usdKrw', makeRate(fxFetchedAt), staleNow);
    snapshot = mergeTicker(snapshot, 'upbit', 'BTC', makeUpbit(staleNow), staleNow);
    snapshot = mergeTicker(snapshot, 'binance', 'BTC', makeBinance(staleNow), staleNow);
    expect(snapshot.coins.BTC.premiumBinance?.status).toBe('stale');
    expect(snapshot.coins.BTC.premiumBinance?.pct).toBeTypeOf('number');

    snapshot = mergeFxRate(snapshot, 'usdKrw', makeRate(fxFetchedAt), downNow);
    snapshot = mergeTicker(snapshot, 'upbit', 'BTC', makeUpbit(downNow), downNow);
    snapshot = mergeTicker(snapshot, 'binance', 'BTC', makeBinance(downNow), downNow);
    expect(snapshot.coins.BTC.premiumBinance).toBeUndefined();
  });

  it('rejects a delayed older rate without rolling back the accepted FX value', () => {
    const newerTs = BASE_TS + 2_000;
    const olderTs = BASE_TS + 1_000;
    let snapshot = createEmptySnapshot(newerTs);

    snapshot = mergeFxRate(snapshot, 'usdKrw', makeRate(newerTs, { value: 1_450 }), newerTs);
    snapshot = mergeFxRate(snapshot, 'usdKrw', makeRate(olderTs, { value: 1 }), newerTs);

    expect(snapshot.fx.usdKrw).toMatchObject({ fetchedAt: newerTs, value: 1_450 });
  });
});

describe('cross-exchange skew', () => {
  it('marks premium stale when both tickers are individually live but skew exceeds 30s', () => {
    const now = BASE_TS + 1_000;
    const snapshot = seedBtcSnapshot(now, {
      upbitTs: BASE_TS,
      binanceTs: BASE_TS + STALENESS_THRESHOLDS.crossExchangeSkew.maxSkewMs + 1,
    });

    expect(snapshot.coins.BTC.upbit?.status).toBe('live');
    expect(snapshot.coins.BTC.binance?.status).toBe('live');
    expect(snapshot.coins.BTC.premiumBinance).toBeDefined();
    expect(snapshot.coins.BTC.premiumBinance?.status).toBe('stale');
  });
});

describe('omit-on-down invariant', () => {
  it('omits premium when a ticker is down', () => {
    const downNow = BASE_TS + STALENESS_THRESHOLDS.upbit.downAfterMs + 1;
    const snapshot = seedBtcSnapshot(downNow, { upbitTs: BASE_TS, binanceTs: BASE_TS });

    expect(snapshot.coins.BTC.upbit?.status).toBe('down');
    expect(snapshot.coins.BTC.premiumBinance).toBeUndefined();
  });

  it('omits premium when FX is down (>78h)', () => {
    const fxFetchedAt = BASE_TS;
    const downNow = fxFetchedAt + STALENESS_THRESHOLDS.fx.downAfterMs + 1;
    const snapshot = seedBtcSnapshot(downNow, { upbitTs: BASE_TS, binanceTs: BASE_TS });

    expect(snapshot.coins.BTC.premiumBinance).toBeUndefined();
  });

  it('computes premium with stale status when FX is stale but not down', () => {
    const fxFetchedAt = BASE_TS;
    const staleNow = fxFetchedAt + STALENESS_THRESHOLDS.fx.staleAfterMs + 1;
    const snapshot = seedBtcSnapshot(staleNow, { upbitTs: staleNow, binanceTs: staleNow });

    expect(snapshot.coins.BTC.upbit?.status).toBe('live');
    expect(snapshot.coins.BTC.binance?.status).toBe('live');
    expect(snapshot.coins.BTC.premiumBinance).toBeDefined();
    expect(snapshot.coins.BTC.premiumBinance?.status).toBe('stale');
  });
});

describe('merge immutability', () => {
  it('does not mutate the original snapshot and returns a new reference', () => {
    const now = BASE_TS;
    const original = createEmptySnapshot(now);
    const originalCoins = original.coins;
    const originalBtc = original.coins.BTC;

    const merged = mergeTicker(original, 'upbit', 'BTC', makeUpbit(BASE_TS), now);

    expect(merged).not.toBe(original);
    expect(merged.coins).not.toBe(originalCoins);
    expect(merged.coins.BTC).not.toBe(originalBtc);
    expect(original.coins.BTC.upbit).toBeUndefined();
    expect(merged.coins.BTC.upbit).toBeDefined();
  });
});

describe('recomputeSnapshot', () => {
  it('decays ticker statuses and premiums without a further merge when time advances', () => {
    const freshNow = BASE_TS;
    const snapshot = seedBtcSnapshot(freshNow, { upbitTs: BASE_TS, binanceTs: BASE_TS });

    expect(snapshot.coins.BTC.upbit?.status).toBe('live');
    expect(snapshot.coins.BTC.binance?.status).toBe('live');
    expect(snapshot.coins.BTC.premiumBinance?.status).toBe('live');

    const staleNow = BASE_TS + STALENESS_THRESHOLDS.upbit.staleAfterMs + 1;
    const recomputed = recomputeSnapshot(snapshot, staleNow);

    expect(recomputed).not.toBe(snapshot);
    expect(recomputed.coins.BTC.upbit?.status).toBe('stale');
    expect(recomputed.coins.BTC.binance?.status).toBe('stale');
    expect(recomputed.coins.BTC.premiumBinance?.status).toBe('stale');
    expect(snapshot.coins.BTC.upbit?.status).toBe('live');

    const downNow = BASE_TS + STALENESS_THRESHOLDS.upbit.downAfterMs + 1;
    const downRecomputed = recomputeSnapshot(snapshot, downNow);

    expect(downRecomputed.coins.BTC.upbit?.status).toBe('down');
    expect(downRecomputed.coins.BTC.binance?.status).toBe('down');
    expect(downRecomputed.coins.BTC.premiumBinance).toBeUndefined();
    expect(downRecomputed.updatedAt).toBe(downNow);
  });

  it('returns unchanged derived state when now has not advanced past live thresholds', () => {
    const now = BASE_TS + 1_000;
    const snapshot = seedBtcSnapshot(now, { upbitTs: BASE_TS, binanceTs: BASE_TS });

    const recomputed = recomputeSnapshot(snapshot, now);
    expect(recomputed.coins.BTC.upbit?.status).toBe('live');
    expect(recomputed.coins.BTC.binance?.status).toBe('live');
    expect(recomputed.coins.BTC.premiumBinance?.status).toBe('live');
    expect(recomputed.coins.BTC.premiumBinance?.pct).toBe(snapshot.coins.BTC.premiumBinance?.pct);

    const slightlyLater = now + 100;
    const stillLive = recomputeSnapshot(snapshot, slightlyLater);
    expect(stillLive.coins.BTC.upbit?.status).toBe('live');
    expect(stillLive.coins.BTC.binance?.status).toBe('live');
    expect(stillLive.coins.BTC.premiumBinance?.status).toBe('live');
  });

  it('does not mutate the input snapshot', () => {
    const snapshot = seedBtcSnapshot(BASE_TS);
    const originalStatus = snapshot.coins.BTC.upbit?.status;

    recomputeSnapshot(snapshot, BASE_TS + STALENESS_THRESHOLDS.upbit.downAfterMs + 1);

    expect(snapshot.coins.BTC.upbit?.status).toBe(originalStatus);
  });
});

describe('mergeFxRate krwPerJpy', () => {
  it('derives krwPerJpy when both USD/KRW and USD/JPY are present', () => {
    const now = BASE_TS;
    let snapshot = createEmptySnapshot(now);
    snapshot = mergeFxRate(snapshot, 'usdKrw', makeRate(BASE_TS), now);
    expect(snapshot.fx.krwPerJpy).toBeUndefined();

    snapshot = mergeFxRate(snapshot, 'usdJpy', makeRate(BASE_TS, { value: USD_JPY }), now);
    expect(snapshot.fx.krwPerJpy).toBeCloseTo(USD_KRW / USD_JPY, 12);
  });
});
