import { z } from 'zod';

export const FX_CACHE_KEY_PREFIX = 'kimp:fx:';

export function utcDateString(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function fxCacheKey(utcDate: string): string {
  return `${FX_CACHE_KEY_PREFIX}${utcDate}`;
}

export interface StoredFxRates {
  usdKrw: { value: number; fetchedAt: number; source: string; ratesDate: string };
  usdJpy: { value: number; fetchedAt: number; source: string; ratesDate: string };
}

export function readFxCache(storage: Storage, nowMs: number): StoredFxRates | null {
  try {
    const raw = storage.getItem(fxCacheKey(utcDateString(nowMs)));
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const rate = z.object({
      value: z.number().positive(),
      fetchedAt: z.number().int().nonnegative().max(nowMs),
      source: z.string().min(1),
      ratesDate: z.iso.date(),
    });
    const result = z.object({ usdKrw: rate, usdJpy: rate }).safeParse(parsed);
    if (!result.success) return null;
    const { usdKrw, usdJpy } = result.data;
    if (
      usdKrw.source !== usdJpy.source ||
      usdKrw.ratesDate !== usdJpy.ratesDate ||
      usdKrw.fetchedAt !== usdJpy.fetchedAt ||
      utcDateString(usdKrw.fetchedAt) !== utcDateString(nowMs)
    )
      return null;
    return result.data;
  } catch {
    return null;
  }
}

export function writeFxCache(storage: Storage, nowMs: number, rates: StoredFxRates): void {
  try {
    storage.setItem(fxCacheKey(utcDateString(nowMs)), JSON.stringify(rates));
  } catch {
    // Quota / privacy mode — ignore.
  }
}
