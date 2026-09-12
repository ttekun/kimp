import { describe, expect, it } from 'vitest';

import {
  checkRatesDivergence,
  computeDivergencePct,
  FX_DIVERGENCE_THRESHOLD_PCT,
  normalizeErApiResponse,
  normalizeFrankfurterResponse,
} from '../../src/connectors/fx.js';
import {
  erApiFixture,
  erApiWithEolFixture,
  frankfurterDivergentFixture,
  frankfurterFixture,
  fxMalformedFixtures,
} from './fixtures/fx.js';

const FETCHED_AT = 1_786_900_000_000;

describe('normalizeErApiResponse', () => {
  it('normalizes live-captured er-api response with correct ratesDate from time_last_update_unix', () => {
    const result = normalizeErApiResponse(erApiFixture, FETCHED_AT);

    expect(result).toEqual({
      usdKrw: {
        value: 1414.860465,
        fetchedAt: FETCHED_AT,
        source: 'er-api',
        ratesDate: '2026-08-16',
      },
      usdJpy: {
        value: 159.225847,
        fetchedAt: FETCHED_AT,
        source: 'er-api',
        ratesDate: '2026-08-16',
      },
      nextUpdateUnix: 1_786_926_221,
      timeEolDetected: false,
      timeEolUnix: null,
    });
  });

  it('detects time_eol_unix when non-zero (docs field; unverified live at 0)', () => {
    const result = normalizeErApiResponse(erApiWithEolFixture, FETCHED_AT);

    expect(result?.timeEolDetected).toBe(true);
    expect(result?.timeEolUnix).toBe(1_900_000_000);
  });

  it.each([
    ['missing KRW/JPY rates', fxMalformedFixtures.erApiMissingRates],
    ['wrong result field', fxMalformedFixtures.erApiWrongResult],
    ['null payload', null],
    ['non-object payload', 'fx'],
  ])('returns null for malformed er-api input: %s', (_label, payload) => {
    expect(normalizeErApiResponse(payload, FETCHED_AT)).toBeNull();
  });
});

describe('normalizeFrankfurterResponse', () => {
  it('normalizes live-captured Frankfurter response with ratesDate from date field', () => {
    const result = normalizeFrankfurterResponse(frankfurterFixture, FETCHED_AT);

    expect(result).toEqual({
      usdKrw: {
        value: 1411.27,
        fetchedAt: FETCHED_AT,
        source: 'frankfurter',
        ratesDate: '2026-08-14',
      },
      usdJpy: {
        value: 159.01,
        fetchedAt: FETCHED_AT,
        source: 'frankfurter',
        ratesDate: '2026-08-14',
      },
    });
  });

  it.each([
    ['missing JPY', fxMalformedFixtures.frankfurterMissingJpy],
    ['bad date format', fxMalformedFixtures.frankfurterBadDate],
    ['null payload', null],
  ])('returns null for malformed Frankfurter input: %s', (_label, payload) => {
    expect(normalizeFrankfurterResponse(payload, FETCHED_AT)).toBeNull();
  });
});

describe('checkRatesDivergence', () => {
  it('flags divergence when KRW differs by more than 2%', () => {
    const primary = normalizeErApiResponse(erApiFixture, FETCHED_AT)!;
    const fallback = normalizeFrankfurterResponse(frankfurterDivergentFixture, FETCHED_AT)!;

    const result = checkRatesDivergence(primary, fallback);

    expect(result.diverged).toBe(true);
    expect(result.krwDivergencePct).toBeGreaterThan(FX_DIVERGENCE_THRESHOLD_PCT);
    expect(result.jpyDivergencePct).toBeLessThan(FX_DIVERGENCE_THRESHOLD_PCT);
  });

  it('does not flag live-captured er-api vs Frankfurter pair (within 2%)', () => {
    const primary = normalizeErApiResponse(erApiFixture, FETCHED_AT)!;
    const fallback = normalizeFrankfurterResponse(frankfurterFixture, FETCHED_AT)!;

    const result = checkRatesDivergence(primary, fallback);

    expect(result.diverged).toBe(false);
    expect(result.krwDivergencePct).toBeCloseTo(0.256, 2);
    expect(result.jpyDivergencePct).toBeCloseTo(0.136, 2);
  });
});

describe('computeDivergencePct', () => {
  it('returns Infinity for invalid denominators', () => {
    expect(computeDivergencePct(0, 100)).toBe(Infinity);
    expect(computeDivergencePct(Number.NaN, 100)).toBe(Infinity);
  });
});
