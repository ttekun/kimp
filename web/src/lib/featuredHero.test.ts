import { describe, expect, it } from 'vitest';

import { FX_EM_DASH } from './formatFx';
import { formatHeroPremium, krwToUsd, selectHeroRows } from './featuredHero';
import { rowOmitsPremium } from './premiumTable';
import type { FeedStatus, MarketSnapshot, Premium, Rate, UpbitTicker } from './types';

const NOW = 1_700_000_000_000;

function rate(value = 1400): Rate {
  return { value, fetchedAt: NOW, source: 'er-api', ratesDate: '2026-08-16' };
}

function upbit(price: number, status: FeedStatus = 'live'): UpbitTicker {
  return { price, ts: NOW, status, change24hPct: 1, volume24hKrw: 1e11 };
}

function ticker(price: number, status: FeedStatus = 'live', ts = NOW) {
  return { price, ts, status };
}

function premium(pct: number, status: FeedStatus = 'live'): Premium {
  return {
    pct,
    diffKrw: pct * 1000,
    computedAt: NOW,
    inputTs: { upbit: NOW, target: NOW, fx: NOW },
    status,
  };
}

function snapshot(): MarketSnapshot {
  return {
    updatedAt: NOW,
    fx: { usdKrw: rate(1400), usdJpy: rate(150), krwPerJpy: 1400 / 150 },
    coins: {
      BTC: {
        upbit: upbit(100_000_000),
        binance: ticker(70_000),
        bitbank: ticker(10_000_000),
        premiumBinance: premium(-0.5),
        premiumBitbank: premium(0.2),
      },
      ETH: {
        upbit: upbit(4_000_000, 'stale'),
        binance: ticker(2_800, 'stale', NOW - 23_000),
        bitbank: ticker(400_000),
        premiumBinance: premium(1.2, 'stale'),
        premiumBitbank: premium(0.8),
      },
      XRP: {
        upbit: upbit(2_000),
        binance: ticker(1.4),
        bitbank: ticker(200),
        premiumBinance: premium(2.0),
        premiumBitbank: premium(1.5),
      },
      SOL: {
        upbit: upbit(150_000),
        binance: ticker(100),
        bitbank: ticker(15_000),
        premiumBinance: premium(-1.1),
        premiumBitbank: premium(-0.3),
      },
      DOT: {
        upbit: upbit(1_200, 'down'),
        binance: ticker(0.9),
        bitbank: ticker(140),
        premiumBinance: premium(-0.26, 'down'),
        premiumBitbank: premium(-0.26, 'down'),
      },
      DOGE: {
        upbit: upbit(140),
        binance: ticker(0.1),
        bitbank: ticker(15),
        premiumBinance: premium(0.1),
        premiumBitbank: premium(0.05),
      },
    },
  };
}

describe('formatHeroPremium', () => {
  it('omits a down premium even when a leftover -0.26 value is present', () => {
    const { binance } = selectHeroRows(snapshot(), 'DOT');
    expect(rowOmitsPremium(binance)).toBe(true);
    const view = formatHeroPremium(binance);
    expect(view.omit).toBe(true);
    expect(view.text).toBe(FX_EM_DASH);
    expect(view.text).not.toContain('-0.26');
  });

  it('formats a live BTC premium at hero copy, not the placeholder', () => {
    const { binance } = selectHeroRows(snapshot(), 'BTC');
    const view = formatHeroPremium(binance);
    expect(view.omit).toBe(false);
    expect(view.text).toContain('-0.50%');
    expect(view.sign).toBe('down');
  });

  it('marks ETH stale with an age tooltip', () => {
    const { binance } = selectHeroRows(snapshot(), 'ETH');
    const view = formatHeroPremium(binance);
    expect(view.stale).toBe(true);
    expect(view.tooltip).toBe('last update 23s ago');
  });
});

describe('krwToUsd', () => {
  it('divides Upbit KRW by USD/KRW', () => {
    expect(krwToUsd(89_237_000, 1_418.5)).toBeCloseTo(62_909, 0);
  });
});
