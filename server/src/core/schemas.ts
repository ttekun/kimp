import { z } from 'zod';

import { COIN_SYMBOLS } from './symbols.js';

export const feedStatusSchema = z.enum(['live', 'stale', 'down']);

const tickerBaseSchema = z.object({
  unavailable: z.boolean().optional(),
  price: z.number(),
  ts: z.number().int().nonnegative(),
  status: feedStatusSchema,
});

export const upbitTickerSchema = tickerBaseSchema.extend({
  change24hPct: z.number(),
  volume24hKrw: z.number().nonnegative(),
});

export const binanceTickerSchema = tickerBaseSchema;
export const bitbankTickerSchema = tickerBaseSchema;

export const rateSchema = z.object({
  value: z.number(),
  fetchedAt: z.number().int().nonnegative(),
  source: z.string().min(1),
  ratesDate: z.string().min(1),
});

export const premiumSchema = z.object({
  pct: z.number(),
  diffKrw: z.number(),
  computedAt: z.number().int().nonnegative(),
  inputTs: z.object({
    upbit: z.number().int().nonnegative(),
    target: z.number().int().nonnegative(),
    fx: z.number().int().nonnegative(),
  }),
  status: feedStatusSchema,
});

const coinSnapshotSchema = z.object({
  upbit: upbitTickerSchema.optional(),
  binance: binanceTickerSchema.optional(),
  bitbank: bitbankTickerSchema.optional(),
  premiumBinance: premiumSchema.optional(),
  premiumBitbank: premiumSchema.optional(),
});

const coinsSchema = z.object(
  Object.fromEntries(COIN_SYMBOLS.map((symbol) => [symbol, coinSnapshotSchema])) as Record<
    (typeof COIN_SYMBOLS)[number],
    typeof coinSnapshotSchema
  >,
);

export const marketSnapshotSchema = z.object({
  updatedAt: z.number().int().nonnegative(),
  fx: z.object({
    usdKrw: rateSchema.optional(),
    usdJpy: rateSchema.optional(),
    krwPerJpy: z.number().optional(),
    usdtKrwImplied: rateSchema.optional(),
  }),
  coins: coinsSchema,
});
