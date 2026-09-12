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
  time_last_update_unix: z.number().int().nonnegative(),
  time_last_update_utc: z.string().min(1),
  time_next_update_unix: z.number().int().nonnegative(),
  time_next_update_utc: z.string().min(1),
  time_eol_unix: z.number().int().nonnegative().optional(),
  time_eol: z.string().optional(),
  base_code: z.string().min(1),
  rates: z.record(z.string(), z.number()),
});

export type ErApiResponse = z.infer<typeof erApiResponseSchema>;

/**
 * Frankfurter latest wire shape (live-captured 2026-08-16).
 * ECB reference rates; `date` is the rates business date (YYYY-MM-DD).
 */
export const frankfurterResponseSchema = z.object({
  amount: z.number().positive(),
  base: z.literal('USD'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.object({
    KRW: z.number().positive(),
    JPY: z.number().positive(),
  }),
});

export type FrankfurterResponse = z.infer<typeof frankfurterResponseSchema>;
