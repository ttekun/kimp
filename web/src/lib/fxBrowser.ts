import {
  ER_API_URL,
  FRANKFURTER_URL,
  normalizeErApiResponse,
  normalizeFrankfurterResponse,
  type FxRates,
} from '@kimchi/fx-normalize';

import { readFxCache, writeFxCache } from './fxCache';

export interface FxBrowserOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  storage?: Storage | null;
}

export async function loadFxRates(options: FxBrowserOptions = {}): Promise<FxRates | null> {
  const fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const nowMs = now();
  let storage = options.storage ?? null;
  if (options.storage === undefined) {
    try {
      storage = globalThis.localStorage ?? null;
    } catch {
      /* Storage may be blocked. */
    }
  }

  if (storage) {
    const cached = readFxCache(storage, nowMs);
    if (cached) {
      return {
        usdKrw: cached.usdKrw,
        usdJpy: cached.usdJpy,
      };
    }
  }

  const primary = await fetchJson(fetchFn, ER_API_URL);
  const fromErApi = primary === null ? null : normalizeErApiResponse(primary, nowMs);
  if (fromErApi) {
    const rates = { usdKrw: fromErApi.usdKrw, usdJpy: fromErApi.usdJpy };
    if (storage) {
      writeFxCache(storage, nowMs, rates);
    }
    return rates;
  }

  const fallback = await fetchJson(fetchFn, FRANKFURTER_URL);
  const fromFrankfurter = fallback === null ? null : normalizeFrankfurterResponse(fallback, nowMs);
  if (fromFrankfurter && storage) {
    writeFxCache(storage, nowMs, fromFrankfurter);
  }
  return fromFrankfurter;
}

async function fetchJson(fetchFn: typeof fetch, url: string): Promise<unknown | null> {
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
