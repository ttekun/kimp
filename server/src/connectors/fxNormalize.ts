import { rateSchema } from '../core/schemas.js';
import type { Rate } from '../core/types.js';
import { erApiResponseSchema, frankfurterResponseSchema, type ErApiResponse } from './fxSchemas.js';

export const ER_API_URL = 'https://open.er-api.com/v6/latest/USD';
export const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW,JPY';
export const ER_API_SOURCE = 'er-api';
export const FRANKFURTER_SOURCE = 'frankfurter';

export interface FxRates {
  usdKrw: Rate;
  usdJpy: Rate;
}

export interface NormalizedErApiResult extends FxRates {
  nextUpdateUnix: number;
  timeEolDetected: boolean;
  timeEolUnix: number | null;
}

function parsePositiveRate(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function unixToRatesDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1_000).toISOString().slice(0, 10);
}

function buildRate(
  value: number,
  fetchedAt: number,
  source: string,
  ratesDate: string,
): Rate | null {
  const rate: Rate = { value, fetchedAt, source, ratesDate };
  const parsed = rateSchema.safeParse(rate);
  return parsed.success ? parsed.data : null;
}

function extractErApiRates(
  data: ErApiResponse,
  fetchedAt: number,
): { usdKrw: Rate; usdJpy: Rate } | null {
  const krw = parsePositiveRate(data.rates.KRW);
  const jpy = parsePositiveRate(data.rates.JPY);
  if (krw === null || jpy === null) {
    return null;
  }

  const ratesDate = unixToRatesDate(data.time_last_update_unix);
  const usdKrw = buildRate(krw, fetchedAt, ER_API_SOURCE, ratesDate);
  const usdJpy = buildRate(jpy, fetchedAt, ER_API_SOURCE, ratesDate);

  if (!usdKrw || !usdJpy) {
    return null;
  }

  return { usdKrw, usdJpy };
}

function detectTimeEol(data: ErApiResponse): { detected: boolean; unix: number | null } {
  const eolUnix = data.time_eol_unix ?? 0;
  const eolString = data.time_eol;

  if (eolUnix > 0) {
    return { detected: true, unix: eolUnix };
  }

  if (typeof eolString === 'string' && eolString.length > 0) {
    return { detected: true, unix: null };
  }

  return { detected: false, unix: null };
}

export function normalizeErApiResponse(
  raw: unknown,
  fetchedAt: number,
): NormalizedErApiResult | null {
  const parsed = erApiResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const rates = extractErApiRates(parsed.data, fetchedAt);
  if (!rates) {
    return null;
  }

  const eol = detectTimeEol(parsed.data);

  return {
    ...rates,
    nextUpdateUnix: parsed.data.time_next_update_unix,
    timeEolDetected: eol.detected,
    timeEolUnix: eol.unix,
  };
}

export function normalizeFrankfurterResponse(raw: unknown, fetchedAt: number): FxRates | null {
  const parsed = frankfurterResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const usdKrw = buildRate(parsed.data.rates.KRW, fetchedAt, FRANKFURTER_SOURCE, parsed.data.date);
  const usdJpy = buildRate(parsed.data.rates.JPY, fetchedAt, FRANKFURTER_SOURCE, parsed.data.date);

  if (!usdKrw || !usdJpy) {
    return null;
  }

  return { usdKrw, usdJpy };
}
