import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFxBrowserClient } from './fxBrowser';
import { readFxSeed } from './fxCache';

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

const erApiFixture = {
  result: 'success',
  time_last_update_unix: 1_786_838_551,
  time_last_update_utc: 'Sun, 16 Aug 2026 00:02:31 +0000',
  time_next_update_unix: 1_786_926_221,
  time_next_update_utc: 'Mon, 17 Aug 2026 00:23:41 +0000',
  base_code: 'USD',
  rates: { USD: 1, JPY: 159.225847, KRW: 1414.860465 },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function createRoutingFetch(handlers: Record<string, () => Response>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers[url];
    if (!handler) throw new Error(`Unexpected fetch URL: ${url}`);
    return handler();
  }) as unknown as typeof fetch;
}

const ER_API_URL = 'https://open.er-api.com/v6/latest/USD';
const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW,JPY';

describe('createFxBrowserClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('binds the default fetch to globalThis (no "Illegal invocation")', async () => {
    // `window.fetch` throws "Illegal invocation" when called with a `this` other than
    // `window`/`globalThis`. FxPoller calls `this.fetchFn(url)`, so an unbound reference
    // (`fetchFn: fetch`) would break in a real browser; only `fetch.bind(globalThis)`
    // survives. Simulate that contract with a fetch stub that checks its `this`.
    const onRates = vi.fn();
    const storage = createFakeStorage();
    const stubFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(jsonResponse(erApiFixture));
    });
    vi.stubGlobal('fetch', stubFetch);

    // No `fetchFn` override — exercises fxBrowser's own `fetch.bind(globalThis)` default.
    const client = createFxBrowserClient({ onRates }, { now: Date.now, storage });
    client.start();
    await vi.waitFor(() => expect(onRates).toHaveBeenCalled());
    client.stop();
  });

  it('persists a seed after a successful poll and reuses it on the next session without fetching', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-16T12:00:00.000Z');
    vi.setSystemTime(now);

    const storage = createFakeStorage();
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: () => jsonResponse(erApiFixture),
      [FRANKFURTER_URL]: () => jsonResponse({ amount: 1, base: 'USD', date: '2026-08-16', rates: { KRW: 1414.86, JPY: 159.23 } }),
    });

    const first = createFxBrowserClient({ onRates: vi.fn() }, { fetchFn, now: Date.now, storage });
    first.start();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(5_000); // let the cross-check settle
    first.stop();

    const seed = readFxSeed(storage, Date.now());
    expect(seed).not.toBeNull();

    const fetchCallsBeforeResume = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length;
    const onRates = vi.fn();
    const second = createFxBrowserClient({ onRates }, { fetchFn, now: Date.now, storage });
    second.start();

    expect(onRates).toHaveBeenCalledTimes(1);
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsBeforeResume);
    second.stop();
  });

  it('fetches immediately when the persisted seed has already expired', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-16T12:00:00.000Z');
    vi.setSystemTime(now);

    const storage = createFakeStorage();
    const fetchFn = createRoutingFetch({
      [ER_API_URL]: () => jsonResponse(erApiFixture),
      [FRANKFURTER_URL]: () => jsonResponse({ amount: 1, base: 'USD', date: '2026-08-16', rates: { KRW: 1414.86, JPY: 159.23 } }),
    });

    const first = createFxBrowserClient({ onRates: vi.fn() }, { fetchFn, now: Date.now, storage });
    first.start();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    first.stop();

    // Jump well past the persisted schedule (the fixture's next_update, plus grace).
    vi.setSystemTime(Date.parse('2026-08-18T00:00:00.000Z'));

    const fetchCallsBeforeResume = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length;
    const onRates = vi.fn();
    const second = createFxBrowserClient({ onRates }, { fetchFn, now: Date.now, storage });
    second.start();
    await vi.waitFor(() =>
      expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        fetchCallsBeforeResume,
      ),
    );
    second.stop();
  });

  it('still fetches when localStorage is blocked (private mode)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(erApiFixture));
    const onRates = vi.fn();

    const client = createFxBrowserClient(
      { onRates },
      { fetchFn, now: Date.now, storage: null },
    );
    client.start();
    await vi.waitFor(() => expect(onRates).toHaveBeenCalled());
    client.stop();
  });
});
