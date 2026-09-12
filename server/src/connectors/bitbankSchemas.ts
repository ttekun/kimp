import { z } from 'zod';

/**
 * Bitbank ticker wire shape (live-captured 2026-08-16).
 * Numeric quote fields are JSON strings (nullable when a book side is empty).
 * Timestamp is a number. REST batch rows include `pair`; WS payloads omit it.
 */
/** Nullable on the wire when a side of the book is empty (thin pairs or one-sided books). */
const bitbankWireQuoteSchema = z.union([z.string(), z.null()]);

export const bitbankWireTickerDataSchema = z.object({
  sell: bitbankWireQuoteSchema,
  buy: bitbankWireQuoteSchema,
  open: z.string(),
  high: z.string(),
  low: z.string(),
  last: z.string(),
  vol: z.string(),
  timestamp: z.number().int().nonnegative(),
});

export type BitbankWireTickerData = z.infer<typeof bitbankWireTickerDataSchema>;

export const bitbankWireTickerRowSchema = bitbankWireTickerDataSchema.extend({
  pair: z.string().min(1),
});

export type BitbankWireTickerRow = z.infer<typeof bitbankWireTickerRowSchema>;

/** REST GET /tickers envelope (rows validated individually after pair filtering). */
export const bitbankRestTickersEnvelopeSchema = z.object({
  success: z.literal(1),
  data: z.array(z.unknown()),
});

/** REST GET /tickers envelope with fully validated rows (single-pair or test fixtures). */
export const bitbankRestTickersResponseSchema = z.object({
  success: z.literal(1),
  data: z.array(bitbankWireTickerRowSchema),
});

export type BitbankRestTickersResponse = z.infer<typeof bitbankRestTickersResponseSchema>;

/** REST GET /{pair}/ticker envelope (no pair field in data). */
export const bitbankRestSingleTickerResponseSchema = z.object({
  success: z.literal(1),
  data: bitbankWireTickerDataSchema,
});

export type BitbankRestSingleTickerResponse = z.infer<typeof bitbankRestSingleTickerResponseSchema>;

/**
 * Socket.IO `message` event payload for ticker rooms (live-captured 2026-08-16).
 * `message.pid` appears in older docs but was absent in live capture — optional.
 */
export const bitbankWsTickerMessageSchema = z.object({
  room_name: z.string().min(1),
  message: z.object({
    pid: z.number().int().optional(),
    data: bitbankWireTickerDataSchema,
  }),
});

export type BitbankWsTickerMessage = z.infer<typeof bitbankWsTickerMessageSchema>;

/** Circuit-break wire shape (live-captured REST + WS 2026-08-16). */
export const bitbankCircuitBreakDataSchema = z.object({
  mode: z.string().min(1),
  estimated_itayose_price: z.string().nullable(),
  estimated_itayose_amount: z.string().nullable(),
  itayose_upper_price: z.string().nullable(),
  itayose_lower_price: z.string().nullable(),
  upper_trigger_price: z.string().nullable(),
  lower_trigger_price: z.string().nullable(),
  fee_type: z.string(),
  reopen_timestamp: z.number().nullable(),
  timestamp: z.number().int().nonnegative(),
});

export type BitbankCircuitBreakData = z.infer<typeof bitbankCircuitBreakDataSchema>;

export const bitbankCircuitBreakWsMessageSchema = z.object({
  room_name: z.string().min(1),
  message: z.object({
    data: bitbankCircuitBreakDataSchema,
  }),
});

export type BitbankCircuitBreakWsMessage = z.infer<typeof bitbankCircuitBreakWsMessageSchema>;

/** REST GET /{pair}/circuit_break_info envelope. */
export const bitbankRestCircuitBreakResponseSchema = z.object({
  success: z.literal(1),
  data: bitbankCircuitBreakDataSchema,
});

/** REST GET https://api.bitbank.cc/v1/spot/status (market status per pair). */
export const bitbankMarketStatusResponseSchema = z.object({
  success: z.literal(1),
  data: z.object({
    statuses: z.array(
      z.object({
        pair: z.string().min(1),
        status: z.string().min(1),
        min_amount: z.string(),
      }),
    ),
  }),
});

export type BitbankMarketStatusResponse = z.infer<typeof bitbankMarketStatusResponseSchema>;
