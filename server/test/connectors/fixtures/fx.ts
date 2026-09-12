/**
 * Recorded from live FX API calls on 2026-08-16.
 * Used as unit-test fixtures — tests must not call the network.
 */

/** er-api GET /v6/latest/USD (rates trimmed; full response has 160+ currencies). */
export const erApiFixture = {
  result: 'success',
  provider: 'https://www.exchangerate-api.com',
  documentation: 'https://www.exchangerate-api.com/docs/free',
  terms_of_use: 'https://www.exchangerate-api.com/terms',
  time_last_update_unix: 1_786_838_551,
  time_last_update_utc: 'Sun, 16 Aug 2026 00:02:31 +0000',
  time_next_update_unix: 1_786_926_221,
  time_next_update_utc: 'Mon, 17 Aug 2026 00:23:41 +0000',
  time_eol_unix: 0,
  base_code: 'USD',
  rates: {
    USD: 1,
    JPY: 159.225847,
    KRW: 1414.860465,
  },
} as const;

/** Frankfurter GET /v1/latest?base=USD&symbols=KRW,JPY */
export const frankfurterFixture = {
  amount: 1.0,
  base: 'USD',
  date: '2026-08-14',
  rates: {
    JPY: 159.01,
    KRW: 1411.27,
  },
} as const;

export const fxMalformedFixtures = {
  erApiMissingRates: {
    result: 'success',
    time_last_update_unix: 1_786_838_551,
    time_last_update_utc: 'Sun, 16 Aug 2026 00:02:31 +0000',
    time_next_update_unix: 1_786_926_221,
    time_next_update_utc: 'Mon, 17 Aug 2026 00:23:41 +0000',
    base_code: 'USD',
    rates: { USD: 1 },
  },
  erApiWrongResult: {
    ...erApiFixture,
    result: 'error',
  },
  frankfurterMissingJpy: {
    amount: 1.0,
    base: 'USD',
    date: '2026-08-14',
    rates: { KRW: 1411.27 },
  },
  frankfurterBadDate: {
    ...frankfurterFixture,
    date: 'not-a-date',
  },
} as const;

/** Synthetic er-api fixture with time_eol_unix set (not seen live; per docs/03). */
export const erApiWithEolFixture = {
  ...erApiFixture,
  time_eol_unix: 1_900_000_000,
  time_eol: 'Tue, 01 Jan 2030 00:00:00 +0000',
} as const;

/** Synthetic divergent Frankfurter rates (>2% off er-api KRW). */
export const frankfurterDivergentFixture = {
  ...frankfurterFixture,
  rates: {
    JPY: 159.01,
    KRW: 1500,
  },
} as const;
