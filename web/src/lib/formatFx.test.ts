import { describe, expect, it } from 'vitest';

import {
  formatFxFreshnessLabel,
  formatFxReferenceTime,
  formatFxSourceBadge,
  formatJpyKrw,
  formatUsdKrw,
  formatUsdtKrw,
  FX_EM_DASH,
} from './formatFx';

describe('formatFx', () => {
  it('formats live rates with tabular-friendly fixed fractions', () => {
    expect(formatUsdKrw(1414.86)).toBe('1,414.9');
    expect(formatJpyKrw(8.885123)).toBe('8.8851');
    expect(formatUsdtKrw(1414.8)).toBe('1,414.8');
  });

  it('renders em dash for missing or non-finite values (never a frozen 0 styled as current)', () => {
    expect(formatUsdKrw(undefined)).toBe(FX_EM_DASH);
    expect(formatJpyKrw(undefined)).toBe(FX_EM_DASH);
    expect(formatUsdtKrw(Number.NaN)).toBe(FX_EM_DASH);
    expect(formatUsdKrw(Number.POSITIVE_INFINITY)).toBe(FX_EM_DASH);
  });

  it('builds a source + rates-date badge from Rate fields', () => {
    expect(
      formatFxSourceBadge({
        value: 1414,
        fetchedAt: 1,
        source: 'er-api',
        ratesDate: '2026-08-16',
      }),
    ).toBe('er-api 08-16');
    expect(formatFxSourceBadge(undefined)).toBeNull();
  });

  it('formats the provider reference time from observedAt, falling back to fetchedAt', () => {
    expect(
      formatFxReferenceTime({
        value: 1414,
        fetchedAt: Date.parse('2026-08-16T05:00:00Z'),
        source: 'er-api',
        ratesDate: '2026-08-16',
        observedAt: Date.parse('2026-08-16T00:02:31Z'),
      }),
    ).toBe('00:02 UTC');
    expect(
      formatFxReferenceTime({
        value: 1414,
        fetchedAt: Date.parse('2026-08-16T05:00:00Z'),
        source: 'er-api',
        ratesDate: '2026-08-16',
      }),
    ).toBe('05:00 UTC');
    expect(formatFxReferenceTime(undefined)).toBeNull();
  });

  it('labels freshness modes honestly (no fabricated "intraday" claim)', () => {
    expect(formatFxFreshnessLabel('live')).toBe('daily rate');
    expect(formatFxFreshnessLabel('stale')).toBe('daily rate — stale');
    expect(formatFxFreshnessLabel('down')).toBe('unavailable');
  });
});
