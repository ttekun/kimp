import { describe, expect, it } from 'vitest';

import { fxCacheKey, readFxCache, utcDateString, writeFxCache } from './fxCache';

describe('fxCache', () => {
  it('namespaces keys by UTC date', () => {
    expect(fxCacheKey('2026-09-12')).toBe('kimp:fx:2026-09-12');
    expect(utcDateString(Date.UTC(2026, 8, 12, 1, 0, 0))).toBe('2026-09-12');
  });

  it('round-trips rates for the current UTC day only', () => {
    const storage = new Map<string, string>();
    const fake: Storage = {
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

    const now = Date.UTC(2026, 8, 12, 15, 0, 0);
    const rates = {
      usdKrw: { value: 1400, fetchedAt: now, source: 'er-api', ratesDate: '2026-09-12' },
      usdJpy: { value: 150, fetchedAt: now, source: 'er-api', ratesDate: '2026-09-12' },
    };

    writeFxCache(fake, now, rates);
    expect(readFxCache(fake, now)).toEqual(rates);
    expect(readFxCache(fake, now + 24 * 60 * 60 * 1_000)).toBeNull();
  });
});
