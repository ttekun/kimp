import { z } from 'zod';

/**
 * Binance combined-stream miniTicker wire shape (live-captured 2026-08-16).
 * Wrapper: { stream, data }; data fields are strings except event time E.
 * Kept separate from core/schemas.ts, which validates internal normalized shapes.
 */
export const binanceMiniTickerDataSchema = z.object({
  e: z.literal('24hrMiniTicker'),
  E: z.number().int().nonnegative(),
  s: z.string().min(1),
  c: z.string(),
  o: z.string(),
  h: z.string(),
  l: z.string(),
  v: z.string(),
  q: z.string(),
});

export type BinanceMiniTickerData = z.infer<typeof binanceMiniTickerDataSchema>;

export const binanceCombinedStreamMessageSchema = z.object({
  stream: z.string().min(1),
  data: binanceMiniTickerDataSchema,
});

export type BinanceCombinedStreamMessage = z.infer<typeof binanceCombinedStreamMessageSchema>;

/**
 * Binance REST /api/v3/ticker/24hr wire shape (live-captured 2026-08-16).
 * Numeric prices and percents are JSON strings; closeTime is a number.
 */
export const binanceRestTickerSchema = z.object({
  symbol: z.string().min(1),
  lastPrice: z.string(),
  closeTime: z.number().int().nonnegative(),
});

export type BinanceRestTicker = z.infer<typeof binanceRestTickerSchema>;

export const binanceRestTickerArraySchema = z.array(binanceRestTickerSchema);
