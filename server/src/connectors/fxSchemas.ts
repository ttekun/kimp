import { z } from 'zod';

/**
 * ExchangeRate-API open endpoint wire shape (live-captured 2026-08-16).
 * Docs mention `time_eol`; live responses expose `time_eol_unix` (0 when unset).
 */
export const erApiResponseSchema = z.object({
  result: z.literal('success'),
  provider: z.string().optional(),
  documentation: z.string().optional(),
  terms_of_use: z.string().optional(),
  time_last_update_unix: z.number().int().nonnegative().max(8_640_000_000_000),
  time_last_update_utc: z.string().min(1),
  time_next_update_unix: z.number().int().nonnegative(),
  time_next_update_utc: z.string().min(1),
  time_eol_unix: z.number().int().nonnegative().optional(),
  time_eol: z.string().optional(),
  base_code: z.literal('USD'),
  rates: z.record(z.string(), z.number()),
});

export type ErApiResponse = z.infer<typeof erApiResponseSchema>;

/**
 * Frankfurter latest wire shape (live-captured 2026-08-16).
 * ECB reference rates; `date` is the rates business date (YYYY-MM-DD).
 */
export const frankfurterResponseSchema = z.object({
  amount: z.literal(1),
  base: z.literal('USD'),
  date: z.iso.date(),
  rates: z.object({
    KRW: z.number().positive(),
    JPY: z.number().positive(),
  }),
});

export type FrankfurterResponse = z.infer<typeof frankfurterResponseSchema>;
