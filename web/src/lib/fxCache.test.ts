import { describe, expect, it } from 'vitest';

import type { FxPollerSeed } from '@kimchi/fx-poller';

import { FX_CACHE_KEY, readFxSeed, writeFxSeed } from './fxCache';

function createFakeStorage(): Storage {
  const storage = new Map<string, string>();
  return {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: () => null,
    removeItem: (key) => {
      storage.delete(key);
    },
    setItem: (key, value) => {
      storage.set(key, value);
    },
  };
}

function makeSeed(now: number, nextPrimaryPollAt: number): FxPollerSeed {
  return {
    rates: {
      usdKrw: { value: 1400, fetchedAt: now, source: 'er-api', ratesDate: '2026-09-12', observedAt: now },
      usdJpy: { value: 150, fetchedAt: now, source: 'er-api', ratesDate: '2026-09-12', observedAt: now },
    },
    fromPrimary: true,
    nextPrimaryPollAt,
  };
}

describe('fxCache', () => {
  it('round-trips a seed while its scheduled next poll is still in the future', () => {
    const storage = createFakeStorage();
    const now = Date.UTC(2026, 8, 12, 15, 0, 0);
    const seed = makeSeed(now, now + 60 * 60 * 1_000);

    writeFxSeed(storage, seed);
    expect(readFxSeed(storage, now)).toEqual(seed);
  });

  it('rejects a seed once its scheduled next poll has passed', () => {
    const storage = createFakeStorage();
    const now = Date.UTC(2026, 8, 12, 15, 0, 0);
    const seed = makeSeed(now, now + 60 * 60 * 1_000);

    writeFxSeed(storage, seed);
    expect(readFxSeed(storage, seed.nextPrimaryPollAt + 1)).toBeNull();
  });

  it('rejects a seed scheduled shortly after midnight even though the UTC date has changed', () => {
    // This is the exact bug scenario: a pre-update fetch just before midnight schedules
    // its next poll for shortly after the provider's real update (past midnight), not at
    // midnight itself. A calendar-date cache would have wrongly expired this early.
    const storage = createFakeStorage();
    const fetchedAt = Date.UTC(2026, 8, 12, 23, 58, 0);
    const nextPrimaryPollAt = Date.UTC(2026, 8, 13, 0, 30, 0);
    const seed = makeSeed(fetchedAt, nextPrimaryPollAt);

    writeFxSeed(storage, seed);
    // Read right after midnight, before the scheduled poll time: still valid.
    expect(readFxSeed(storage, Date.UTC(2026, 8, 13, 0, 5, 0))).toEqual(seed);
    // Read after the scheduled poll time: expired.
    expect(readFxSeed(storage, Date.UTC(2026, 8, 13, 0, 31, 0))).toBeNull();
  });

  it('rejects a seed with a fetchedAt in the future (clock-skew / forged storage)', () => {
    const storage = createFakeStorage();
    const now = Date.UTC(2026, 8, 12, 15, 0, 0);
    const seed = makeSeed(now + 60_000, now + 60 * 60 * 1_000);

    writeFxSeed(storage, seed);
    expect(readFxSeed(storage, now)).toBeNull();
  });

  it('rejects malformed JSON and unknown keys', () => {
    const storage = createFakeStorage();
    storage.setItem(FX_CACHE_KEY, '{not json');
    expect(readFxSeed(storage, Date.now())).toBeNull();
    expect(readFxSeed(createFakeStorage(), Date.now())).toBeNull();
  });
});
