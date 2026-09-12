import type { CoinSymbol } from './symbols.js';

export type FeedStatus = 'live' | 'stale' | 'down';

export interface TickerBase {
  price: number;
  ts: number;
  status: FeedStatus;
}

/** Upbit last trade in KRW; includes 24h change/volume for the UI change column. */
export interface UpbitTicker extends TickerBase {
  change24hPct: number;
  volume24hKrw: number;
}

/** Binance miniTicker close (USDT). */
export type BinanceTicker = TickerBase;

/** Bitbank midpoint `(buy + sell) / 2` in JPY. */
export type BitbankTicker = TickerBase;

export type Ticker = UpbitTicker | BinanceTicker | BitbankTicker;

export interface Rate {
  value: number;
  fetchedAt: number;
  source: string;
  ratesDate: string;
}

export interface PremiumInputTimestamps {
  upbit: number;
  target: number;
  fx: number;
}

export interface Premium {
  pct: number;
  diffKrw: number;
  computedAt: number;
  inputTs: PremiumInputTimestamps;
  status: FeedStatus;
}

export interface CoinSnapshot {
  upbit?: UpbitTicker;
  binance?: BinanceTicker;
  bitbank?: BitbankTicker;
  premiumBinance?: Premium;
  premiumBitbank?: Premium;
}

export interface FxSnapshot {
  usdKrw?: Rate;
  usdJpy?: Rate;
  /** Derived from usdKrw / usdJpy when both are present; omitted until then. */
  krwPerJpy?: number;
  usdtKrwImplied?: Rate;
}

export interface MarketSnapshot {
  updatedAt: number;
  fx: FxSnapshot;
  coins: Record<CoinSymbol, CoinSnapshot>;
}
