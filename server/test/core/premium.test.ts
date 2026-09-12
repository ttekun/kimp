import { describe, expect, it } from 'vitest';

import {
  computeKrwPerJpy,
  computePremiumBinance,
  computePremiumBitbank,
  MIN_DENOMINATOR,
} from '../../src/core/premium.js';
import type { BinanceTicker, BitbankTicker, Rate, UpbitTicker } from '../../src/core/types.js';

const SAMPLE_TS = 1_786_862_979_078;
const COMPUTED_AT = SAMPLE_TS + 1_000;

/** Verified er-api sample values from docs/03-api-integration.md (2026-08-16). */
const VERIFIED_USD_KRW = 1414.86;
const VERIFIED_USD_JPY = 159.23;

function makeRate(value: number, overrides: Partial<Rate> = {}): Rate {
  return {
    value,
    fetchedAt: SAMPLE_TS,
    source: 'er-api',
    ratesDate: '2026-08-16',
    ...overrides,
  };
}

function makeUpbit(price: number, overrides: Partial<UpbitTicker> = {}): UpbitTicker {
  return {
    price,
    change24hPct: 0,
    volume24hKrw: 0,
    ts: SAMPLE_TS,
    status: 'live',
    ...overrides,
  };
}

function makeBinance(price: number, overrides: Partial<BinanceTicker> = {}): BinanceTicker {
  return {
    price,
    ts: SAMPLE_TS,
    status: 'live',
    ...overrides,
  };
}

function makeBitbank(price: number, overrides: Partial<BitbankTicker> = {}): BitbankTicker {
  return {
    price,
    ts: SAMPLE_TS,
    status: 'live',
    ...overrides,
  };
}

describe('computeKrwPerJpy', () => {
  it('derives the verified 2026-08-16 cross rate with full precision', () => {
    const krwPerJpy = computeKrwPerJpy(VERIFIED_USD_KRW, VERIFIED_USD_JPY);

    expect(krwPerJpy).not.toBeNull();
    expect(krwPerJpy!).toBeCloseTo(8.88563712868178, 12);
    expect(krwPerJpy!).not.toBe(8.885);
    expect(String(krwPerJpy)).toContain('8.885637');
  });

  it('returns null for a zero or near-zero USD/JPY denominator', () => {
    expect(computeKrwPerJpy(VERIFIED_USD_KRW, 0)).toBeNull();
    expect(computeKrwPerJpy(VERIFIED_USD_KRW, MIN_DENOMINATOR / 10)).toBeNull();
  });

  it('returns null for non-positive or non-finite USD/JPY', () => {
    expect(computeKrwPerJpy(VERIFIED_USD_KRW, -159.23)).toBeNull();
    expect(computeKrwPerJpy(VERIFIED_USD_KRW, Number.NaN)).toBeNull();
    expect(computeKrwPerJpy(VERIFIED_USD_KRW, Number.POSITIVE_INFINITY)).toBeNull();
    expect(computeKrwPerJpy(VERIFIED_USD_KRW, Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('returns null for non-positive or non-finite USD/KRW', () => {
    expect(computeKrwPerJpy(-VERIFIED_USD_KRW, VERIFIED_USD_JPY)).toBeNull();
    expect(computeKrwPerJpy(0, VERIFIED_USD_JPY)).toBeNull();
    expect(computeKrwPerJpy(Number.NaN, VERIFIED_USD_JPY)).toBeNull();
    expect(computeKrwPerJpy(Number.POSITIVE_INFINITY, VERIFIED_USD_JPY)).toBeNull();
    expect(computeKrwPerJpy(Number.NEGATIVE_INFINITY, VERIFIED_USD_JPY)).toBeNull();
  });
});

describe('computePremiumBinance (Pair A)', () => {
  it('computes premium from verified 2026-08-16 fixtures (hand-verified arithmetic)', () => {
    // docs/01 featured card: Upbit 89,237,000 KRW; Binance $63,074.86 USDT.
    // docs/03 FX: USD/KRW 1414.86.
    // binanceKrw = 63_074.86 * 1_414.86 = 89_242_096.4196
    // pct = (89_237_000 / 89_242_096.4196 - 1) * 100 ≈ -0.005710779782708286
    // diffKrw = 89_237_000 - 89_242_096.4196 ≈ -5_096.4196
    const premium = computePremiumBinance({
      upbit: makeUpbit(89_237_000),
      binance: makeBinance(63_074.86),
      usdKrw: makeRate(VERIFIED_USD_KRW),
      computedAt: COMPUTED_AT,
    });

    expect(premium).not.toBeNull();
    expect(premium!.pct).toBeCloseTo(-0.005710779782708286, 10);
    expect(premium!.diffKrw).toBeCloseTo(-5_096.419599995017, 6);
    expect(premium!.status).toBe('live');
    expect(premium!.computedAt).toBe(COMPUTED_AT);
    expect(premium!.inputTs).toEqual({
      upbit: SAMPLE_TS,
      target: SAMPLE_TS,
      fx: SAMPLE_TS,
    });
  });

  it('uses the official USD/KRW rate even when an implied USDT/KRW rate diverges sharply', () => {
    const officialFx = makeRate(VERIFIED_USD_KRW);
    const upbit = makeUpbit(89_237_000);
    const binance = makeBinance(63_074.86);

    const withOfficialOnly = computePremiumBinance({
      upbit,
      binance,
      usdKrw: officialFx,
      computedAt: COMPUTED_AT,
    });

    const withDivergentImplied = computePremiumBinance({
      upbit,
      binance,
      usdKrw: officialFx,
      usdtKrwImplied: makeRate(1_500), // ~6% above official; display-only in v1
      computedAt: COMPUTED_AT,
    });

    expect(withOfficialOnly).not.toBeNull();
    expect(withDivergentImplied).not.toBeNull();
    expect(withDivergentImplied!.pct).toBe(withOfficialOnly!.pct);
    expect(withDivergentImplied!.diffKrw).toBe(withOfficialOnly!.diffKrw);
  });

  it('preserves raw precision instead of baking in display rounding', () => {
    const premiumA = computePremiumBinance({
      upbit: makeUpbit(100_000.004),
      binance: makeBinance(70.000_03),
      usdKrw: makeRate(1_414.860_001),
      computedAt: COMPUTED_AT,
    });

    const premiumB = computePremiumBinance({
      upbit: makeUpbit(100_000.006),
      binance: makeBinance(70.000_03),
      usdKrw: makeRate(1_414.860_001),
      computedAt: COMPUTED_AT,
    });

    expect(premiumA).not.toBeNull();
    expect(premiumB).not.toBeNull();

    const roundedPctA = Math.round(premiumA!.pct * 100) / 100;
    const roundedPctB = Math.round(premiumB!.pct * 100) / 100;
    expect(roundedPctA).toBe(roundedPctB);
    expect(premiumA!.pct).not.toBe(premiumB!.pct);
    expect(premiumA!.diffKrw).not.toBe(premiumB!.diffKrw);
  });

  it('returns null when USD/KRW FX is missing', () => {
    expect(
      computePremiumBinance({
        upbit: makeUpbit(89_237_000),
        binance: makeBinance(63_074.86),
        usdKrw: undefined,
        computedAt: COMPUTED_AT,
      }),
    ).toBeNull();
  });

  it('returns null for zero or near-zero binanceKrw denominators', () => {
    expect(
      computePremiumBinance({
        upbit: makeUpbit(89_237_000),
        binance: makeBinance(0),
        usdKrw: makeRate(VERIFIED_USD_KRW),
        computedAt: COMPUTED_AT,
      }),
    ).toBeNull();

    expect(
      computePremiumBinance({
        upbit: makeUpbit(89_237_000),
        binance: makeBinance(MIN_DENOMINATOR / VERIFIED_USD_KRW),
        usdKrw: makeRate(VERIFIED_USD_KRW),
        computedAt: COMPUTED_AT,
      }),
    ).toBeNull();
  });

  it('returns null when any input feed is down', () => {
    expect(
      computePremiumBinance({
        upbit: makeUpbit(89_237_000, { status: 'down' }),
        binance: makeBinance(63_074.86),
        usdKrw: makeRate(VERIFIED_USD_KRW),
        computedAt: COMPUTED_AT,
      }),
    ).toBeNull();
  });

  it('marks premium stale when any input is stale but still computes values', () => {
    const premium = computePremiumBinance({
      upbit: makeUpbit(89_237_000, { status: 'stale' }),
      binance: makeBinance(63_074.86),
      usdKrw: makeRate(VERIFIED_USD_KRW),
      computedAt: COMPUTED_AT,
    });

    expect(premium).not.toBeNull();
    expect(premium!.status).toBe('stale');
    expect(premium!.pct).toBeCloseTo(-0.005710779782708286, 10);
  });
});

describe('computePremiumBitbank (Pair B)', () => {
  it('computes premium via the KRW/JPY cross rate from verified 2026-08-16 fixtures', () => {
    // docs/03 Bitbank BTC sample: buy 10_048_000, sell 10_048_001 → mid 10_048_000.5 JPY.
    // docs/01 Upbit BTC: 89_237_000 KRW.
    // krwPerJpy = 1_414.86 / 159.23 ≈ 8.88563712868178
    // bitbankKrw = 10_048_000.5 * 8.88563712868178 ≈ 89_282_886.3118131
    // pct ≈ -0.051394297058060534; diffKrw ≈ -45_886.3118131
    const premium = computePremiumBitbank({
      upbit: makeUpbit(89_237_000),
      bitbank: makeBitbank(10_048_000.5),
      usdKrw: makeRate(VERIFIED_USD_KRW),
      usdJpy: makeRate(VERIFIED_USD_JPY),
      computedAt: COMPUTED_AT,
    });

    expect(premium).not.toBeNull();
    expect(premium!.pct).toBeCloseTo(-0.051394297058060534, 10);
    expect(premium!.diffKrw).toBeCloseTo(-45_886.31181310117, 6);
    expect(premium!.status).toBe('live');
    expect(premium!.inputTs).toEqual({
      upbit: SAMPLE_TS,
      target: SAMPLE_TS,
      fx: SAMPLE_TS,
    });
  });

  it('returns null when USD/JPY FX is missing', () => {
    expect(
      computePremiumBitbank({
        upbit: makeUpbit(89_237_000),
        bitbank: makeBitbank(10_048_000.5),
        usdKrw: makeRate(VERIFIED_USD_KRW),
        usdJpy: undefined,
        computedAt: COMPUTED_AT,
      }),
    ).toBeNull();
  });

  it('returns null when USD/KRW FX is missing', () => {
    expect(
      computePremiumBitbank({
        upbit: makeUpbit(89_237_000),
        bitbank: makeBitbank(10_048_000.5),
        usdKrw: undefined,
        usdJpy: makeRate(VERIFIED_USD_JPY),
        computedAt: COMPUTED_AT,
      }),
    ).toBeNull();
  });

  it('returns null for invalid USD/KRW FX values', () => {
    const base = {
      upbit: makeUpbit(89_237_000),
      bitbank: makeBitbank(10_048_000.5),
      usdJpy: makeRate(VERIFIED_USD_JPY),
      computedAt: COMPUTED_AT,
    };

    expect(computePremiumBitbank({ ...base, usdKrw: makeRate(Number.NaN) })).toBeNull();
    expect(
      computePremiumBitbank({ ...base, usdKrw: makeRate(Number.POSITIVE_INFINITY) }),
    ).toBeNull();
    expect(
      computePremiumBitbank({ ...base, usdKrw: makeRate(Number.NEGATIVE_INFINITY) }),
    ).toBeNull();
    expect(computePremiumBitbank({ ...base, usdKrw: makeRate(-VERIFIED_USD_KRW) })).toBeNull();
  });

  it('returns null for invalid USD/JPY FX values', () => {
    const base = {
      upbit: makeUpbit(89_237_000),
      bitbank: makeBitbank(10_048_000.5),
      usdKrw: makeRate(VERIFIED_USD_KRW),
      computedAt: COMPUTED_AT,
    };

    expect(computePremiumBitbank({ ...base, usdJpy: makeRate(Number.NaN) })).toBeNull();
    expect(
      computePremiumBitbank({ ...base, usdJpy: makeRate(Number.POSITIVE_INFINITY) }),
    ).toBeNull();
    expect(
      computePremiumBitbank({ ...base, usdJpy: makeRate(Number.NEGATIVE_INFINITY) }),
    ).toBeNull();
    expect(computePremiumBitbank({ ...base, usdJpy: makeRate(-VERIFIED_USD_JPY) })).toBeNull();
  });

  it('returns null for zero or near-zero bitbankKrw denominators', () => {
    expect(
      computePremiumBitbank({
        upbit: makeUpbit(89_237_000),
        bitbank: makeBitbank(0),
        usdKrw: makeRate(VERIFIED_USD_KRW),
        usdJpy: makeRate(VERIFIED_USD_JPY),
        computedAt: COMPUTED_AT,
      }),
    ).toBeNull();
  });

  it('returns null when any input feed is down', () => {
    expect(
      computePremiumBitbank({
        upbit: makeUpbit(89_237_000),
        bitbank: makeBitbank(10_048_000.5, { status: 'down' }),
        usdKrw: makeRate(VERIFIED_USD_KRW),
        usdJpy: makeRate(VERIFIED_USD_JPY),
        computedAt: COMPUTED_AT,
      }),
    ).toBeNull();
  });

  it('marks premium stale when the target tick is stale but still computes values', () => {
    const premium = computePremiumBitbank({
      upbit: makeUpbit(89_237_000),
      bitbank: makeBitbank(10_048_000.5, { status: 'stale' }),
      usdKrw: makeRate(VERIFIED_USD_KRW),
      usdJpy: makeRate(VERIFIED_USD_JPY),
      computedAt: COMPUTED_AT,
    });

    expect(premium).not.toBeNull();
    expect(premium!.status).toBe('stale');
    expect(premium!.pct).toBeCloseTo(-0.051394297058060534, 10);
  });
});
