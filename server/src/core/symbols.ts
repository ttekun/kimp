export const COIN_SYMBOLS = ['BTC', 'ETH', 'XRP', 'SOL', 'DOT', 'DOGE'] as const;
export type CoinSymbol = (typeof COIN_SYMBOLS)[number];

export const TARGET_EXCHANGES = ['binance', 'bitbank'] as const;
export type TargetExchange = (typeof TARGET_EXCHANGES)[number];

export const UPBIT_MARKET_CODES = {
  BTC: 'KRW-BTC',
  ETH: 'KRW-ETH',
  XRP: 'KRW-XRP',
  SOL: 'KRW-SOL',
  DOT: 'KRW-DOT',
  DOGE: 'KRW-DOGE',
} as const satisfies Record<CoinSymbol, string>;

export const BINANCE_MARKET_CODES = {
  BTC: 'btcusdt',
  ETH: 'ethusdt',
  XRP: 'xrpusdt',
  SOL: 'solusdt',
  DOT: 'dotusdt',
  DOGE: 'dogeusdt',
} as const satisfies Record<CoinSymbol, string>;

export const BITBANK_MARKET_CODES = {
  BTC: 'btc_jpy',
  ETH: 'eth_jpy',
  XRP: 'xrp_jpy',
  SOL: 'sol_jpy',
  DOT: 'dot_jpy',
  DOGE: 'doge_jpy',
} as const satisfies Record<CoinSymbol, string>;

export const EXCHANGE_MARKET_CODES = {
  binance: BINANCE_MARKET_CODES,
  bitbank: BITBANK_MARKET_CODES,
} as const satisfies Record<TargetExchange, Record<CoinSymbol, string>>;
