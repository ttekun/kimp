import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  binanceTickerSchema,
  bitbankTickerSchema,
  marketSnapshotSchema,
  premiumSchema,
  rateSchema,
  upbitTickerSchema,
} from '../../src/core/schemas.js';

const SAMPLE_TS = 1_786_862_979_078;

const validRate = {
  value: 1414.86,
  fetchedAt: SAMPLE_TS,
  source: 'er-api',
  ratesDate: '2026-08-16',
};

const validUpbitTicker = {
  price: 148_500_000,
  change24hPct: 1.25,
  volume24hKrw: 1_234_567_890_000,
  ts: SAMPLE_TS,
  status: 'live' as const,
};

const validBinanceTicker = {
  price: 104_250.5,
  ts: SAMPLE_TS,
  status: 'live' as const,
};

const validBitbankTicker = {
  price: 10_048_000.5,
  ts: SAMPLE_TS,
  status: 'live' as const,
};

const validPremium = {
  pct: 2.15,
  diffKrw: 3_150_000,
  computedAt: SAMPLE_TS,
  inputTs: {
    upbit: SAMPLE_TS,
    target: SAMPLE_TS,
    fx: SAMPLE_TS,
  },
  status: 'live' as const,
};

const validMarketSnapshot = {
  updatedAt: SAMPLE_TS,
  fx: {
    usdKrw: validRate,
    usdJpy: { ...validRate, value: 159.23 },
    krwPerJpy: 1414.86 / 159.23,
    usdtKrwImplied: { ...validRate, value: 1418.5 },
  },
  coins: {
    BTC: {
      upbit: validUpbitTicker,
      binance: validBinanceTicker,
      bitbank: validBitbankTicker,
      premiumBinance: validPremium,
      premiumBitbank: validPremium,
    },
    ETH: {},
    XRP: {},
    SOL: {},
    DOT: {},
    DOGE: {},
  },
};

function expectZodFailure(result: { success: boolean; error?: ZodError }, path?: string): void {
  expect(result.success).toBe(false);
  if (!result.success && path !== undefined) {
    const error = result.error;
    expect(error).toBeDefined();
    expect(error!.issues.some((issue) => issue.path.join('.') === path)).toBe(true);
  }
}

describe('rateSchema', () => {
  it('accepts a valid normalized rate', () => {
    expect(rateSchema.safeParse(validRate).success).toBe(true);
  });

  it('rejects a missing required field', () => {
    const invalid = { ...validRate };
    delete (invalid as Partial<typeof validRate>).ratesDate;
    expectZodFailure(rateSchema.safeParse(invalid), 'ratesDate');
  });

  it('rejects a wrong type for value', () => {
    expectZodFailure(rateSchema.safeParse({ ...validRate, value: '1414.86' }), 'value');
  });

  it('rejects an invalid enum value when nested in premium status', () => {
    expectZodFailure(premiumSchema.safeParse({ ...validPremium, status: 'offline' }), 'status');
  });
});

describe('upbitTickerSchema', () => {
  it('accepts a valid Upbit ticker', () => {
    expect(upbitTickerSchema.safeParse(validUpbitTicker).success).toBe(true);
  });

  it('rejects missing change24hPct', () => {
    const invalid = { ...validUpbitTicker };
    delete (invalid as Partial<typeof validUpbitTicker>).change24hPct;
    expectZodFailure(upbitTickerSchema.safeParse(invalid), 'change24hPct');
  });

  it('rejects wrong type for price', () => {
    expectZodFailure(
      upbitTickerSchema.safeParse({ ...validUpbitTicker, price: '148500000' }),
      'price',
    );
  });

  it('rejects invalid status enum', () => {
    expectZodFailure(
      upbitTickerSchema.safeParse({ ...validUpbitTicker, status: 'paused' }),
      'status',
    );
  });
});

describe('binanceTickerSchema', () => {
  it('accepts a valid Binance ticker', () => {
    expect(binanceTickerSchema.safeParse(validBinanceTicker).success).toBe(true);
  });

  it('rejects missing ts', () => {
    const invalid = { ...validBinanceTicker };
    delete (invalid as Partial<typeof validBinanceTicker>).ts;
    expectZodFailure(binanceTickerSchema.safeParse(invalid), 'ts');
  });

  it('rejects wrong type for price', () => {
    expectZodFailure(
      binanceTickerSchema.safeParse({ ...validBinanceTicker, price: null }),
      'price',
    );
  });

  it('rejects invalid status enum', () => {
    expectZodFailure(
      binanceTickerSchema.safeParse({ ...validBinanceTicker, status: 'unknown' }),
      'status',
    );
  });
});

describe('bitbankTickerSchema', () => {
  it('accepts a valid Bitbank ticker (mid price)', () => {
    expect(bitbankTickerSchema.safeParse(validBitbankTicker).success).toBe(true);
  });

  it('rejects missing price', () => {
    const invalid = { ...validBitbankTicker };
    delete (invalid as Partial<typeof validBitbankTicker>).price;
    expectZodFailure(bitbankTickerSchema.safeParse(invalid), 'price');
  });

  it('rejects wrong type for ts', () => {
    expectZodFailure(
      bitbankTickerSchema.safeParse({ ...validBitbankTicker, ts: '1786862979078' }),
      'ts',
    );
  });

  it('rejects invalid status enum', () => {
    expectZodFailure(
      bitbankTickerSchema.safeParse({ ...validBitbankTicker, status: 'error' }),
      'status',
    );
  });
});

describe('premiumSchema', () => {
  it('accepts a valid premium', () => {
    expect(premiumSchema.safeParse(validPremium).success).toBe(true);
  });

  it('rejects missing inputTs.target', () => {
    expectZodFailure(
      premiumSchema.safeParse({
        ...validPremium,
        inputTs: { upbit: SAMPLE_TS, fx: SAMPLE_TS },
      }),
      'inputTs.target',
    );
  });

  it('rejects wrong type for diffKrw', () => {
    expectZodFailure(premiumSchema.safeParse({ ...validPremium, diffKrw: '3150000' }), 'diffKrw');
  });

  it('rejects invalid status enum', () => {
    expectZodFailure(premiumSchema.safeParse({ ...validPremium, status: 'offline' }), 'status');
  });
});

describe('marketSnapshotSchema', () => {
  it('accepts a valid market snapshot', () => {
    expect(marketSnapshotSchema.safeParse(validMarketSnapshot).success).toBe(true);
  });

  it('rejects a snapshot missing a required coin key', () => {
    const invalidCoins = { ...validMarketSnapshot.coins };
    delete (invalidCoins as Partial<typeof validMarketSnapshot.coins>).DOT;
    expectZodFailure(
      marketSnapshotSchema.safeParse({ ...validMarketSnapshot, coins: invalidCoins }),
      'coins.DOT',
    );
  });

  it('rejects wrong type for krwPerJpy', () => {
    expectZodFailure(
      marketSnapshotSchema.safeParse({
        ...validMarketSnapshot,
        fx: { ...validMarketSnapshot.fx, krwPerJpy: '8.885' },
      }),
      'fx.krwPerJpy',
    );
  });

  it('accepts an empty FX block before connectors populate rates', () => {
    expect(
      marketSnapshotSchema.safeParse({
        updatedAt: SAMPLE_TS,
        fx: {},
        coins: {
          BTC: {},
          ETH: {},
          XRP: {},
          SOL: {},
          DOT: {},
          DOGE: {},
        },
      }).success,
    ).toBe(true);
  });

  it('rejects invalid nested ticker status', () => {
    expectZodFailure(
      marketSnapshotSchema.safeParse({
        ...validMarketSnapshot,
        coins: {
          ...validMarketSnapshot.coins,
          BTC: {
            ...validMarketSnapshot.coins.BTC,
            upbit: { ...validUpbitTicker, status: 'broken' },
          },
        },
      }),
      'coins.BTC.upbit.status',
    );
  });
});
