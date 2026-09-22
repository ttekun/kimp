import { ER_API_SOURCE, FxPoller, type FxRates } from '@kimchi/fx-poller';

import { readFxSeed, writeFxSeed } from './fxCache';

export interface FxBrowserCallbacks {
  onRates: (rates: FxRates) => void;
}

export interface FxBrowserClient {
  start: () => void;
  stop: () => void;
}

export interface FxBrowserOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  storage?: Storage | null;
}

function resolveStorage(options: FxBrowserOptions): Storage | null {
  if (options.storage !== undefined) {
    return options.storage;
  }
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Browser FX client: reuses the server's `FxPoller` (provider-aware scheduling,
 * daily fetch budget, primary/fallback + cross-check divergence, error classification)
 * instead of duplicating that logic with a UTC-date cache. A localStorage seed lets a
 * page reload skip a redundant fetch while its previous poll schedule is still valid;
 * the seed is invalidated (see fxCache.ts) once that schedule has passed, so a
 * pre-update rate can never be served past the provider's real next update.
 */
export function createFxBrowserClient(
  callbacks: FxBrowserCallbacks,
  options: FxBrowserOptions = {},
): FxBrowserClient {
  const now = options.now ?? Date.now;
  const fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  const storage = resolveStorage(options);

  const seed = storage ? (readFxSeed(storage, now()) ?? undefined) : undefined;

  let latestRates: FxRates | null = seed?.rates ?? null;
  let latestFromPrimary = seed?.fromPrimary ?? false;

  const persistSeed = (nextPrimaryPollAt: number): void => {
    if (!storage || !latestRates) return;
    writeFxSeed(storage, { rates: latestRates, fromPrimary: latestFromPrimary, nextPrimaryPollAt });
  };

  const poller = new FxPoller({
    fetchFn,
    now,
    seed,
    onRates: (rates) => {
      latestRates = rates;
      latestFromPrimary = rates.usdKrw.source === ER_API_SOURCE;
      callbacks.onRates(rates);
    },
    // Always fires after `onRates` within the same poll cycle, once the new
    // schedule is known — see FxPoller.runPrimaryPoll / runFallbackPoll.
    onScheduled: persistSeed,
  });

  return {
    start: () => {
      void poller.start();
    },
    stop: () => {
      poller.stop();
    },
  };
}
