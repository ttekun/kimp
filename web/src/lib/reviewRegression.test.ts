import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientAggregator, type ClientAggregatorOptions } from './clientAggregator';
import { buildPremiumTableRows } from './premiumTable';
import type { UpbitBrowserCallbacks } from './upbitBrowser';
import type { BitbankBrowserCallbacks } from './bitbankBrowser';
import type { MarketSnapshot } from './types';
import { bitbankWsBtcFixture } from '../../../server/test/connectors/fixtures/bitbank';

const now = bitbankWsBtcFixture.message.data.timestamp;

const rates = {
  usdKrw: { value: 1400, fetchedAt: now, source: 'er-api', ratesDate: '2026-08-16', observedAt: now },
  usdJpy: { value: 150, fetchedAt: now, source: 'er-api', ratesDate: '2026-08-16', observedAt: now },
};

/** Default stub: emits fixed FX rates once on start, like a real client would. */
function defaultCreateFx(): NonNullable<ClientAggregatorOptions['createFx']> {
  return (callbacks) => ({
    start: () => callbacks.onRates(rates),
    stop: () => undefined,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function setup(createFx = defaultCreateFx()) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  let bitbank!: BitbankBrowserCallbacks;
  let upbit!: UpbitBrowserCallbacks;
  let latest!: MarketSnapshot;
  const client = { start: vi.fn(), stop: vi.fn() };
  const aggregator = createClientAggregator({
    createFx,
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
  return { aggregator, bitbank, upbit, snapshot: () => latest };
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

  it('is idempotent: a second start() while running does not restart the FX client', async () => {
    const fxStart = vi.fn();
    const fxStop = vi.fn();
    const h = setup(() => ({ start: fxStart, stop: fxStop }));
    h.aggregator.start();
    h.aggregator.start();
    expect(fxStart).toHaveBeenCalledTimes(1);
    h.aggregator.stop();
    expect(fxStop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
