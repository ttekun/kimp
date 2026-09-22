import { z } from 'zod';

import type { FxPollerSeed } from '@kimchi/fx-poller';

export const FX_CACHE_KEY = 'kimp:fx:v2';

const rateSchema = z.object({
  value: z.number().positive(),
  fetchedAt: z.number().int().nonnegative(),
  source: z.string().min(1),
  ratesDate: z.iso.date(),
  observedAt: z.number().int().nonnegative().optional(),
});

const seedSchema = z.object({
  rates: z.object({ usdKrw: rateSchema, usdJpy: rateSchema }),
  fromPrimary: z.boolean(),
  nextPrimaryPollAt: z.number().int().nonnegative(),
});

/**
 * Reads a persisted poller seed, valid only while its scheduled next primary poll
 * is still in the future and its rates were not fetched after `nowMs` (clock-skew
 * / forged-storage guard). Unlike the old cache, validity is provider-aware —
 * keyed off the poller's own schedule, not the local UTC calendar date — so a
 * pre-update rate cached just before a provider's real update never survives past it.
 */
export function readFxSeed(storage: Storage, nowMs: number): FxPollerSeed | null {
  try {
    const raw = storage.getItem(FX_CACHE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = seedSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      return null;
    }
    const { rates, nextPrimaryPollAt } = parsed.data;
    if (nextPrimaryPollAt <= nowMs) {
      return null;
    }
    if (
      rates.usdKrw.fetchedAt > nowMs ||
      rates.usdJpy.fetchedAt > nowMs ||
      rates.usdKrw.source !== rates.usdJpy.source
    ) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeFxSeed(storage: Storage, seed: FxPollerSeed): void {
  try {
    storage.setItem(FX_CACHE_KEY, JSON.stringify(seed));
  } catch {
    // Quota / privacy mode — ignore.
  }
}
