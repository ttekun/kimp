import type { MarketSnapshot } from '../src/lib/types';

export const E2E_NOW = 1_700_000_000_000;

export function e2eSnapshot(now = E2E_NOW): MarketSnapshot {
  const rate = (value: number) => ({
    value,
    fetchedAt: now,
    source: 'er-api' as const,
    ratesDate: '2026-08-16',
  });
  const upbit = (price: number, status: 'live' | 'stale' | 'down' = 'live') => ({
    price,
    ts: now,
    status,
    change24hPct: 1,
    volume24hKrw: 1e11,
  });
  const ticker = (price: number, status: 'live' | 'stale' | 'down' = 'live') => ({
    price,
    ts: now,
    status,
  });
  const premium = (pct: number, status: 'live' | 'stale' | 'down' = 'live') => ({
    pct,
    diffKrw: pct * 1000,
    computedAt: now,
    inputTs: { upbit: now, target: now, fx: now },
    status,
  });

  return {
    updatedAt: now,
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
        upbit: upbit(4_000_000),
        binance: ticker(2_800),
        bitbank: ticker(400_000),
        premiumBinance: premium(1.2),
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
