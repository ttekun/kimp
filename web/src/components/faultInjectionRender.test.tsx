import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEmptySnapshot,
  mergeFxRate,
  mergeTicker,
  STALENESS_THRESHOLDS,
} from '../../../server/src/core/snapshot';
import { COIN_SYMBOLS } from '../../../server/src/core/symbols';
import { FeaturedHero } from './FeaturedHero';
import { FxStatusBar } from './FxStatusBar';
import { PremiumTable } from './PremiumTable';
import { FX_EM_DASH } from '../lib/formatFx';
import type { BinanceTicker, BitbankTicker, MarketSnapshot, Rate, UpbitTicker } from '../lib/types';

const BASE_TS = 1_700_000_000_000;
const USD_KRW = 1414.86;
const USD_JPY = 159.23;

function makeRate(fetchedAt: number, overrides: Partial<Rate> = {}): Rate {
  return {
    value: USD_KRW,
    fetchedAt,
    source: 'er-api',
    ratesDate: '2026-08-16',
    ...overrides,
  };
}

function makeUpbit(ts: number): UpbitTicker {
  return {
    price: 148_500_000,
    change24hPct: 1,
    volume24hKrw: 1e11,
    ts,
    status: 'live',
  };
}

function makeBinance(ts: number): BinanceTicker {
  return { price: 104_250.5, ts, status: 'live' };
}

function makeBitbank(ts: number): BitbankTicker {
  return { price: 16_500_000, ts, status: 'live' };
}

function seedLive(now: number): MarketSnapshot {
  let snapshot = createEmptySnapshot(now);
  snapshot = mergeFxRate(snapshot, 'usdKrw', makeRate(now), now);
  snapshot = mergeFxRate(snapshot, 'usdJpy', makeRate(now, { value: USD_JPY }), now);
  for (const coin of COIN_SYMBOLS) {
    snapshot = mergeTicker(snapshot, 'upbit', coin, makeUpbit(now), now);
    snapshot = mergeTicker(snapshot, 'binance', coin, makeBinance(now), now);
    snapshot = mergeTicker(snapshot, 'bitbank', coin, makeBitbank(now), now);
  }
  return snapshot;
}

function refresh(
  snapshot: MarketSnapshot,
  now: number,
  feeds: { upbit?: boolean; binance?: boolean; bitbank?: boolean },
): MarketSnapshot {
  let next = snapshot;
  for (const coin of COIN_SYMBOLS) {
    if (feeds.upbit) next = mergeTicker(next, 'upbit', coin, makeUpbit(now), now);
    if (feeds.binance) next = mergeTicker(next, 'binance', coin, makeBinance(now), now);
    if (feeds.bitbank) next = mergeTicker(next, 'bitbank', coin, makeBitbank(now), now);
  }
  return next;
}

function applyClockSkew(snapshot: MarketSnapshot, now: number): MarketSnapshot {
  const skewOffset = STALENESS_THRESHOLDS.crossExchangeSkew.maxSkewMs + 1;
  let next = snapshot;
  next = mergeTicker(next, 'upbit', 'BTC', makeUpbit(now), now);
  next = mergeTicker(next, 'binance', 'BTC', makeBinance(now + skewOffset), now);
  next = mergeTicker(next, 'bitbank', 'BTC', makeBitbank(now + skewOffset), now);
  return next;
}

function renderDashboard(snapshot: MarketSnapshot) {
  return render(
    <>
      <FxStatusBar snapshot={snapshot} connectionStatus="live" />
      <FeaturedHero snapshot={snapshot} />
      <PremiumTable pair="binance" snapshot={snapshot} />
      <PremiumTable pair="bitbank" snapshot={snapshot} />
    </>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
});

describe('fault injection UI (hero + tables + FX dots)', () => {
  it('live snapshot: premiums current, feed dots live', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);
    renderDashboard(seedLive(BASE_TS));

    expect(screen.getByLabelText('BTC Binance premium').getAttribute('data-sign')).toBeTruthy();
    expect(screen.getByLabelText('BTC Binance premium').textContent).not.toBe(FX_EM_DASH);
    expect(screen.getByTitle('Upbit live')).toBeTruthy();
    expect(screen.getByTitle('Binance live')).toBeTruthy();
    expect(screen.getByTitle('Bitbank live')).toBeTruthy();
    expect(screen.getByTitle('FX live')).toBeTruthy();
  });

  it('stale Upbit: computed premium with data-stale, not omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);
    let snapshot = seedLive(BASE_TS);
    vi.setSystemTime(BASE_TS + STALENESS_THRESHOLDS.upbit.staleAfterMs + 1);
    snapshot = refresh(snapshot, Date.now(), { binance: true, bitbank: true });
    renderDashboard(snapshot);

    const hero = screen
      .getByLabelText('BTC featured premium')
      .querySelector('.featured-hero__statement');
    expect(hero?.getAttribute('data-stale')).toBe('true');
    expect(hero?.getAttribute('data-omit')).toBeNull();
    expect(screen.getByLabelText('BTC Binance premium').textContent).not.toBe(FX_EM_DASH);

    const binanceTable = document.querySelector('.premium-table[data-pair="binance"]');
    expect(binanceTable).toBeTruthy();
    const btcRow = within(binanceTable as HTMLElement).getByRole('row', { name: /BTC/ });
    expect(btcRow.getAttribute('data-stale')).toBe('true');
    expect(btcRow.getAttribute('data-omit')).toBeNull();
    expect(screen.getByTitle('Upbit stale')).toBeTruthy();
  });

  it('down Binance: Pair A omitted; Pair B stays a live number', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);
    let snapshot = seedLive(BASE_TS);
    vi.setSystemTime(BASE_TS + STALENESS_THRESHOLDS.binance.downAfterMs + 1);
    snapshot = refresh(snapshot, Date.now(), { upbit: true, bitbank: true });
    renderDashboard(snapshot);

    const hero = screen
      .getByLabelText('BTC featured premium')
      .querySelector('.featured-hero__statement');
    expect(hero?.getAttribute('data-omit')).toBe('true');
    expect(screen.getByLabelText('BTC Binance premium').textContent).toBe(FX_EM_DASH);

    const bitbankPremium = screen.getByLabelText('BTC Bitbank premium');
    expect(bitbankPremium.getAttribute('data-omit')).toBeNull();
    expect(bitbankPremium.textContent).not.toContain(FX_EM_DASH);

    expect(screen.getByTitle('Binance down')).toBeTruthy();
    expect(screen.getByTitle('Bitbank live')).toBeTruthy();
    expect(screen.getByTitle('Upbit live')).toBeTruthy();
  });

  it('clock skew: stale styling, premium still a number (not em dash)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);
    const snapshot = applyClockSkew(seedLive(BASE_TS), BASE_TS);
    renderDashboard(snapshot);

    const hero = screen
      .getByLabelText('BTC featured premium')
      .querySelector('.featured-hero__statement');
    expect(hero?.getAttribute('data-stale')).toBe('true');
    expect(hero?.getAttribute('data-omit')).toBeNull();
    expect(screen.getByLabelText('BTC Binance premium').textContent).not.toBe(FX_EM_DASH);
  });
});
