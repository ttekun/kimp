import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientAggregator, FX_RETRY_INTERVAL_MS } from './clientAggregator';
import { readFxCache, fxCacheKey } from './fxCache';
import { loadFxRates } from './fxBrowser';
import { buildPremiumTableRows } from './premiumTable';
import type { UpbitBrowserCallbacks } from './upbitBrowser';
import type { BitbankBrowserCallbacks } from './bitbankBrowser';
import type { MarketSnapshot } from './types';
import { bitbankWsBtcFixture } from '../../../server/test/connectors/fixtures/bitbank';

const now = bitbankWsBtcFixture.message.data.timestamp;
const rates = {
  usdKrw: { value: 1400, fetchedAt: now, source: 'er-api', ratesDate: '2026-08-16' },
  usdJpy: { value: 150, fetchedAt: now, source: 'er-api', ratesDate: '2026-08-16' },
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function setup(loadFx = vi.fn(async () => rates)) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  let bitbank!: BitbankBrowserCallbacks;
  let upbit!: UpbitBrowserCallbacks;
  let latest!: MarketSnapshot;
  const client = { start: vi.fn(), stop: vi.fn() };
  const aggregator = createClientAggregator({
    loadFx,
    createUpbit: (callbacks) => {
      upbit = callbacks;
      return client;
    },
    createBinance: () => client,
    createBitbank: (callbacks) => {
      bitbank = callbacks;
      return client;
    },
    onSnapshot: (snapshot) => {
      latest = snapshot;
    },
    onStatusChange: vi.fn(),
  });
  return { aggregator, bitbank, upbit, loadFx, snapshot: () => latest };
}

describe('review regressions', () => {
  it('does not restore an unusable Bitbank book on the next publication', async () => {
    const h = setup();
    h.aggregator.start();
    h.upbit.onMessage({
      code: 'KRW-BTC',
      trade_price: 100_000_000,
      signed_change_rate: 0,
      acc_trade_price_24h: 1000,
      timestamp: now,
    });
    h.bitbank.onTickerMessage(bitbankWsBtcFixture);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.snapshot().coins.BTC.premiumBitbank).toBeDefined();
    expect(h.snapshot().coins.BTC.bitbank?.status).toBe('live');
    h.bitbank.onTickerMessage({
      ...bitbankWsBtcFixture,
      message: {
        data: {
          ...bitbankWsBtcFixture.message.data,
          sell: null,
          timestamp: now + 1000,
        },
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.snapshot().coins.BTC.bitbank?.status).toBe('down');
    expect(h.snapshot().coins.BTC.premiumBitbank).toBeUndefined();
    expect(buildPremiumTableRows(h.snapshot(), 'bitbank')[0]?.targetPrice).toBeUndefined();
    h.bitbank.onTickerMessage(bitbankWsBtcFixture);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.snapshot().coins.BTC.bitbank?.status).toBe('down');
    h.bitbank.onTickerMessage({
      ...bitbankWsBtcFixture,
      message: {
        data: {
          ...bitbankWsBtcFixture.message.data,
          timestamp: now + 3000,
        },
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.snapshot().coins.BTC.bitbank?.status).toBe('live');
    h.aggregator.stop();
  });

  it('suppresses circuit-break prices until a new usable tick after recovery', async () => {
    const h = setup();
    h.aggregator.start();
    h.bitbank.onTickerMessage(bitbankWsBtcFixture);
    h.bitbank.onCircuitBreak('BTC', true, now);
    h.bitbank.onTickerMessage(bitbankWsBtcFixture);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.snapshot().coins.BTC.bitbank?.status).toBe('down');
    h.bitbank.onCircuitBreak('BTC', false, now - 1);
    h.bitbank.onTickerMessage(bitbankWsBtcFixture);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.snapshot().coins.BTC.bitbank?.status).toBe('down');
    h.aggregator.stop();
  });

  it('retries failed FX loads and refreshes on the next UTC day', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(rates);
    const h = setup(load);
    h.aggregator.start();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(
      Math.floor(now / 86400000) * 86400000 + 86400000 - FX_RETRY_INTERVAL_MS - 1000,
    );
    await vi.advanceTimersByTimeAsync(FX_RETRY_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(3);
    h.aggregator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores FX responses from a previous start and makes start idempotent', async () => {
    let resolve!: (value: typeof rates) => void;
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue(null);
    const h = setup(load);
    h.aggregator.start();
    h.aggregator.start();
    expect(load).toHaveBeenCalledTimes(1);
    h.aggregator.stop();
    h.aggregator.start();
    resolve(rates);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.snapshot().fx.usdKrw).toBeUndefined();
    h.aggregator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { usdKrw: { value: 1400 }, usdJpy: { value: 150 } },
    { ...rates, usdKrw: { ...rates.usdKrw, fetchedAt: now + 1 } },
    { ...rates, usdKrw: { ...rates.usdKrw, value: -1 } },
    { ...rates, usdJpy: { ...rates.usdJpy, source: 'different' } },
  ])('rejects malformed cached rates: %j', (candidate) => {
    localStorage.setItem(
      fxCacheKey(new Date(now).toISOString().slice(0, 10)),
      JSON.stringify(candidate),
    );
    expect(readFxCache(localStorage, now)).toBeNull();
  });

  it('fetches FX even if the localStorage getter is blocked', async () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}'));
    await expect(loadFxRates({ fetchFn })).resolves.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
