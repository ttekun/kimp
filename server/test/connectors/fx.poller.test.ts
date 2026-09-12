import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ER_API_URL,
  FRANKFURTER_URL,
  FX_429_RETRY_DELAY_MS,
  FX_CROSS_CHECK_DELAY_MS,
  FX_DAILY_FETCH_BUDGET,
  FX_MIN_PRIMARY_INTERVAL_MS,
  FxPoller,
} from '../../src/connectors/fx.js';
import {
  erApiFixture,
  erApiWithEolFixture,
  frankfurterDivergentFixture,
  frankfurterFixture,
} from './fixtures/fx.js';

type FetchHandler = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

function createRoutingFetch(handlers: Record<string, FetchHandler>): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers[url];
    if (!handler) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    return handler(url);
  }) as unknown as typeof fetch;
}

function okJson(body: unknown) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function failHttp(status: number, body = '') {
  return async () => ({
    ok: false,
    status,
    json: async () => JSON.parse(body || '{}'),
    text: async () => body,
  });
}

describe('FxPoller', () => {
  const BASE_TIME = Date.parse('2026-08-16T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches primary on start and invokes onRates with normalized values', async () => {
    const onRates = vi.fn();
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: okJson(erApiFixture),
      [FRANKFURTER_URL]: okJson(frankfurterFixture),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now(), onRates });
    await poller.start();

    expect(onRates).toHaveBeenCalledWith({
      usdKrw: expect.objectContaining({
        value: 1414.860465,
        source: 'er-api',
        ratesDate: '2026-08-16',
      }),
      usdJpy: expect.objectContaining({
        value: 159.225847,
        source: 'er-api',
        ratesDate: '2026-08-16',
      }),
    });

    poller.stop();
  });

  it('falls back to Frankfurter when er-api fails without throwing', async () => {
    const onRates = vi.fn();
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: failHttp(500, 'server error'),
      [FRANKFURTER_URL]: okJson(frankfurterFixture),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now(), onRates });
    await poller.start();

    expect(onRates).toHaveBeenCalledWith({
      usdKrw: expect.objectContaining({ source: 'frankfurter', ratesDate: '2026-08-14' }),
      usdJpy: expect.objectContaining({ source: 'frankfurter' }),
    });

    const health = poller.getHealth();
    expect(health.lastError?.kind).toBe('http_error');
    expect(health.lastSuccessfulFetchAt.frankfurter).not.toBeNull();

    poller.stop();
  });

  it('retains last-good rates when both providers fail on a later cycle', async () => {
    const onRates = vi.fn();
    const failResponse = {
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'fail',
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => erApiFixture,
        text: async () => JSON.stringify(erApiFixture),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => frankfurterFixture,
        text: async () => JSON.stringify(frankfurterFixture),
      })
      .mockResolvedValue(failResponse) as unknown as typeof fetch;

    const poller = new FxPoller({ fetchFn, now: () => Date.now(), onRates });
    await poller.start();
    await vi.advanceTimersByTimeAsync(FX_CROSS_CHECK_DELAY_MS);

    expect(poller.getRates()?.usdKrw.value).toBe(1414.860465);

    await vi.advanceTimersByTimeAsync(FX_MIN_PRIMARY_INTERVAL_MS);
    await vi.waitFor(() => {
      expect(poller.getHealth().status).toBe('stale');
    });

    expect(poller.getRates()?.usdKrw.value).toBe(1414.860465);

    poller.stop();
  });

  it('marks health stale when cross-check divergence exceeds 2%', async () => {
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: okJson(erApiFixture),
      [FRANKFURTER_URL]: okJson(frankfurterDivergentFixture),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now() });
    await poller.start();

    await vi.advanceTimersByTimeAsync(FX_CROSS_CHECK_DELAY_MS);

    const health = poller.getHealth();
    expect(health.lastDivergenceCheck?.diverged).toBe(true);
    expect(health.status).toBe('stale');
    expect(health.lastError?.kind).toBe('divergence');

    poller.stop();
  });

  it('detects time_eol from er-api response', async () => {
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: okJson(erApiWithEolFixture),
      [FRANKFURTER_URL]: okJson(frankfurterFixture),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now() });
    await poller.start();

    expect(poller.getHealth().timeEolDetected).toBe(true);
    expect(poller.getHealth().timeEolUnix).toBe(1_900_000_000);

    poller.stop();
  });

  it('stays within 2-4 fetches/day under normal operation (primary + cross-check)', async () => {
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: okJson(erApiFixture),
      [FRANKFURTER_URL]: okJson(frankfurterFixture),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now() });
    await poller.start();
    await vi.advanceTimersByTimeAsync(FX_CROSS_CHECK_DELAY_MS);

    const health = poller.getHealth();
    expect(health.fetchCountToday).toBeGreaterThanOrEqual(FX_DAILY_FETCH_BUDGET.min);
    expect(health.fetchCountToday).toBeLessThanOrEqual(FX_DAILY_FETCH_BUDGET.max);

    poller.stop();
  });

  it('stays within 2-4 fetches/day when primary fails and fallback is used', async () => {
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: failHttp(429, 'too many requests'),
      [FRANKFURTER_URL]: okJson(frankfurterFixture),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now() });
    await poller.start();

    const health = poller.getHealth();
    expect(health.fetchCountToday).toBeGreaterThanOrEqual(2);
    expect(health.fetchCountToday).toBeLessThanOrEqual(FX_DAILY_FETCH_BUDGET.max);
    expect(health.lastError?.kind).toBe('rate_limited');

    poller.stop();
  });

  it('schedules 429 retry without exceeding daily fetch budget on first failure cycle', async () => {
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: failHttp(429, 'too many'),
      [FRANKFURTER_URL]: okJson(frankfurterFixture),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now() });
    await poller.start();

    expect(poller.getHealth().fetchCountToday).toBe(2);

    await vi.advanceTimersByTimeAsync(FX_429_RETRY_DELAY_MS);

    // Retry is scheduled but budget may block — total should remain ≤4
    expect(poller.getHealth().fetchCountToday).toBeLessThanOrEqual(FX_DAILY_FETCH_BUDGET.max);

    poller.stop();
  });

  it('does not expose raw provider payloads via getRates', async () => {
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: okJson(erApiFixture),
      [FRANKFURTER_URL]: okJson(frankfurterFixture),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now() });
    await poller.start();

    const rates = poller.getRates();
    expect(rates).toEqual({
      usdKrw: expect.objectContaining({
        value: expect.any(Number),
        fetchedAt: expect.any(Number),
        source: expect.any(String),
        ratesDate: expect.any(String),
      }),
      usdJpy: expect.objectContaining({
        value: expect.any(Number),
        fetchedAt: expect.any(Number),
        source: expect.any(String),
        ratesDate: expect.any(String),
      }),
    });
    expect(rates).not.toHaveProperty('rates');
    expect(rates).not.toHaveProperty('result');

    poller.stop();
  });

  it('simulates a full day: 2 fetches on normal path, next primary scheduled off next_update', async () => {
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: okJson(erApiFixture),
      [FRANKFURTER_URL]: okJson(frankfurterFixture),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now() });
    await poller.start();
    expect(poller.getHealth().fetchCountToday).toBe(1);

    await vi.advanceTimersByTimeAsync(FX_CROSS_CHECK_DELAY_MS);
    expect(poller.getHealth().fetchCountToday).toBe(2);
    expect(poller.getHealth().totalFetches).toBe(2);

    // Primary is scheduled max(next_update, now+23h); advance the remaining time to that slot.
    await vi.advanceTimersByTimeAsync(FX_MIN_PRIMARY_INTERVAL_MS - FX_CROSS_CHECK_DELAY_MS);
    await vi.waitFor(() => {
      // totalFetches avoids UTC-midnight reset of fetchCountToday during the 23h advance
      expect(poller.getHealth().totalFetches).toBe(3);
    });

    poller.stop();
  });

  function create429RecoveryFetch(): typeof fetch {
    let erApiCalls = 0;
    return vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === ER_API_URL) {
        erApiCalls += 1;
        if (erApiCalls % 2 === 1) {
          return {
            ok: false,
            status: 429,
            json: async () => ({}),
            text: async () => 'too many requests',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => erApiFixture,
          text: async () => JSON.stringify(erApiFixture),
        };
      }
      if (url === FRANKFURTER_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => frankfurterFixture,
          text: async () => JSON.stringify(frankfurterFixture),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as unknown as typeof fetch;
  }

  /** One 429→fallback→retry→cross-check cycle consumes the full daily budget (4 fetches). */
  async function runDailyCapCycle(poller: FxPoller): Promise<void> {
    await poller.start();
    expect(poller.getHealth().fetchCountToday).toBe(2);

    await vi.advanceTimersByTimeAsync(FX_429_RETRY_DELAY_MS);
    await vi.waitFor(() => {
      expect(poller.getHealth().fetchCountToday).toBe(3);
    });

    await vi.advanceTimersByTimeAsync(FX_CROSS_CHECK_DELAY_MS);
    await vi.waitFor(() => {
      expect(poller.getHealth().fetchCountToday).toBe(FX_DAILY_FETCH_BUDGET.max);
    });
  }

  it('resets daily fetch budget after UTC midnight when previous day hit the cap', async () => {
    const fetchFn = create429RecoveryFetch();
    const poller = new FxPoller({ fetchFn, now: () => Date.now() });

    await runDailyCapCycle(poller);
    const fetchesAfterCap = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchesAfterCap).toBe(4);

    // Advance into the next UTC day without restarting the process.
    vi.setSystemTime(Date.parse('2026-08-17T12:00:00.000Z'));
    expect(poller.getHealth().fetchCountToday).toBe(0);

    // Next scheduled primary is max(next_update, now+23h) from the last successful retry (~Aug 17 11:20).
    await vi.advanceTimersByTimeAsync(FX_MIN_PRIMARY_INTERVAL_MS);
    await vi.waitFor(() => {
      expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        fetchesAfterCap,
      );
    });

    expect(poller.getHealth().fetchCountToday).toBeGreaterThan(0);
    expect(poller.getHealth().fetchCountToday).toBeLessThanOrEqual(FX_DAILY_FETCH_BUDGET.max);

    poller.stop();
  });

  it('recovers and fetches on each of 3 consecutive UTC days that all hit the daily cap', async () => {
    const fetchFn = create429RecoveryFetch();
    const poller = new FxPoller({ fetchFn, now: () => Date.now() });

    /** Next UTC noon after each capped day (day 2 uses Aug 19 — day-1 timers can spill into Aug 18). */
    const nextUtcDayNoons = ['2026-08-17T12:00:00.000Z', '2026-08-19T12:00:00.000Z'];

    let previousFetchTotal = 0;

    for (let day = 0; day < 3; day += 1) {
      const fetchesBeforeDay = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length;

      if (day > 0) {
        vi.setSystemTime(Date.parse(nextUtcDayNoons[day - 1]));
        expect(poller.getHealth().fetchCountToday).toBe(0);
        await vi.runOnlyPendingTimersAsync();
      }

      if (day === 0) {
        await runDailyCapCycle(poller);
      } else {
        let attempts = 0;
        while (
          (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length === fetchesBeforeDay &&
          attempts < 5
        ) {
          await vi.advanceTimersByTimeAsync(FX_MIN_PRIMARY_INTERVAL_MS);
          attempts += 1;
        }

        expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
          fetchesBeforeDay,
        );
        expect(poller.getHealth().fetchCountToday).toBe(2);

        await vi.advanceTimersByTimeAsync(FX_429_RETRY_DELAY_MS);
        await vi.advanceTimersByTimeAsync(FX_CROSS_CHECK_DELAY_MS);
        await vi.waitFor(() => {
          expect(poller.getHealth().fetchCountToday).toBe(FX_DAILY_FETCH_BUDGET.max);
        });
      }

      const fetchesAfterDay = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(fetchesAfterDay).toBe(fetchesBeforeDay + FX_DAILY_FETCH_BUDGET.max);
      expect(fetchesAfterDay).toBeGreaterThan(previousFetchTotal);
      previousFetchTotal = fetchesAfterDay;
    }

    expect(previousFetchTotal).toBe(12);

    poller.stop();
  });

  it('does not mark stale when cross-check fetch fails but primary data is fresh', async () => {
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: okJson(erApiFixture),
      [FRANKFURTER_URL]: failHttp(500, 'cross-check down'),
    });

    const poller = new FxPoller({ fetchFn, now: () => Date.now() });
    await poller.start();
    await vi.advanceTimersByTimeAsync(FX_CROSS_CHECK_DELAY_MS);

    const health = poller.getHealth();
    expect(health.status).toBe('ok');
    expect(health.status).not.toBe('stale');
    expect(health.lastSuccessfulFetchAt.erApi).not.toBeNull();
    expect(health.lastError?.message).toMatch(/cross-check unavailable/i);

    poller.stop();
  });
});
