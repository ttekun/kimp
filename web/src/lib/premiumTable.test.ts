import { describe, expect, it } from 'vitest';

import {
  buildPremiumTableRows,
  rowOmitsPremium,
  rowIsStale,
  sortPremiumTableRows,
  staleAgeTooltip,
} from './premiumTable';
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

describe('buildPremiumTableRows', () => {
  it('builds a row per coin and omits DOT premium when down/missing', () => {
    const rows = buildPremiumTableRows(snapshot(), 'binance');
    expect(rows.map((row) => row.symbol)).toEqual(['BTC', 'ETH', 'XRP', 'SOL', 'DOT', 'DOGE']);
    const dot = rows.find((row) => row.symbol === 'DOT');
    expect(dot?.premiumStatus).toBe('missing');
    expect(rowOmitsPremium(dot!)).toBe(true);
    expect(dot?.targetKrw).toBeCloseTo(0.9 * 1400);
  });

  it('uses Bitbank mid × krwPerJpy for pair B target KRW', () => {
    const btc = buildPremiumTableRows(snapshot(), 'bitbank').find((row) => row.symbol === 'BTC');
    expect(btc?.targetKrw).toBeCloseTo(10_000_000 * (1400 / 150));
    expect(btc?.premiumPct).toBe(0.2);
  });

  it('does not invent target KRW when FX is missing', () => {
    const empty: MarketSnapshot = {
      updatedAt: NOW,
      fx: {},
      coins: {
        BTC: { binance: ticker(1) },
        ETH: {},
        XRP: {},
        SOL: {},
        DOT: {},
        DOGE: {},
      },
    };
    const btc = buildPremiumTableRows(empty, 'binance')[0];
    expect(btc.targetKrw).toBeUndefined();
  });
});

describe('sortPremiumTableRows', () => {
  it('sorts live premiums before stale, then by pct, with missing last', () => {
    const rows = buildPremiumTableRows(snapshot(), 'binance');
    const sorted = sortPremiumTableRows(rows, 'premium', 'desc');
    expect(sorted.map((row) => row.symbol)).toEqual(['XRP', 'DOGE', 'BTC', 'SOL', 'ETH', 'DOT']);
  });

  it('keeps missing premiums last when sorting asc as well', () => {
    const rows = buildPremiumTableRows(snapshot(), 'binance');
    const sorted = sortPremiumTableRows(rows, 'premium', 'asc');
    expect(sorted.at(-1)?.symbol).toBe('DOT');
    expect(sorted[0]?.symbol).toBe('SOL');
  });
});

describe('rowIsStale', () => {
  it('builds an age tooltip for stale rows', () => {
    const eth = buildPremiumTableRows(snapshot(), 'binance').find((row) => row.symbol === 'ETH');
    expect(staleAgeTooltip(eth!)).toBe('last update 23s ago');
  });

  it('flags a row when any input or premium is stale', () => {
    const eth = buildPremiumTableRows(snapshot(), 'binance').find((row) => row.symbol === 'ETH');
    expect(rowIsStale(eth!)).toBe(true);
    const btc = buildPremiumTableRows(snapshot(), 'binance').find((row) => row.symbol === 'BTC');
    expect(rowIsStale(btc!)).toBe(false);
  });
});
