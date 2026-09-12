import { binanceTickerSchema } from '../core/schemas.js';
import { BINANCE_MARKET_CODES, COIN_SYMBOLS, type CoinSymbol } from '../core/symbols.js';
import type { BinanceTicker } from '../core/types.js';
import {
  binanceCombinedStreamMessageSchema,
  binanceRestTickerArraySchema,
  type BinanceMiniTickerData,
  type BinanceRestTicker,
} from './binanceSchemas.js';

export const BINANCE_BROWSER_WS_BASE_URL = 'wss://stream.binance.com:443';
export const BINANCE_WS_BASE_URL_DEFAULT = 'wss://stream.binance.com:9443';
export const BINANCE_REST_TICKER_URL_DEFAULT = 'https://api.binance.com/api/v3/ticker/24hr';

const BINANCE_SYMBOL_TO_COIN = Object.fromEntries(
  COIN_SYMBOLS.map((symbol) => [BINANCE_MARKET_CODES[symbol].toUpperCase(), symbol]),
) as Record<string, CoinSymbol>;

const PLACEHOLDER_TICKER_STATUS = 'live' as const;

export interface BinanceRestBootstrapResult {
  tickers: Array<{ coin: CoinSymbol; ticker: BinanceTicker }>;
}

function parseBinancePrice(value: string): number | null {
  const price = Number.parseFloat(value);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return price;
}

function wireToBinanceTicker(price: number, ts: number): BinanceTicker | null {
  const ticker: BinanceTicker = {
    price,
    ts,
    status: PLACEHOLDER_TICKER_STATUS,
  };

  const parsed = binanceTickerSchema.safeParse(ticker);
  return parsed.success ? parsed.data : null;
}

function resolveCoinFromSymbol(symbol: string): CoinSymbol | null {
  return BINANCE_SYMBOL_TO_COIN[symbol] ?? null;
}

function normalizeMiniTickerData(data: BinanceMiniTickerData): {
  coin: CoinSymbol;
  ticker: BinanceTicker;
} | null {
  const coin = resolveCoinFromSymbol(data.s);
  if (!coin) {
    return null;
  }

  const price = parseBinancePrice(data.c);
  if (price === null) {
    return null;
  }

  const ticker = wireToBinanceTicker(price, data.E);
  return ticker ? { coin, ticker } : null;
}

function normalizeRestTickerRow(row: BinanceRestTicker): {
  coin: CoinSymbol;
  ticker: BinanceTicker;
} | null {
  const coin = resolveCoinFromSymbol(row.symbol);
  if (!coin) {
    return null;
  }

  const price = parseBinancePrice(row.lastPrice);
  if (price === null) {
    return null;
  }

  const ticker = wireToBinanceTicker(price, row.closeTime);
  return ticker ? { coin, ticker } : null;
}

export function normalizeBinanceWsMessage(raw: unknown): {
  coin: CoinSymbol;
  ticker: BinanceTicker;
} | null {
  const parsed = binanceCombinedStreamMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  return normalizeMiniTickerData(parsed.data.data);
}

export function normalizeBinanceRestResponse(raw: unknown): BinanceRestBootstrapResult {
  const parsed = binanceRestTickerArraySchema.safeParse(raw);
  if (!parsed.success) {
    return { tickers: [] };
  }

  const tickers: Array<{ coin: CoinSymbol; ticker: BinanceTicker }> = [];

  for (const item of parsed.data) {
    const normalized = normalizeRestTickerRow(item);
    if (normalized) {
      tickers.push(normalized);
    }
  }

  return { tickers };
}

export function buildBinanceCombinedStreamUrlFromBase(wsBase: string): string {
  const streams = COIN_SYMBOLS.map((symbol) => `${BINANCE_MARKET_CODES[symbol]}@miniTicker`).join(
    '/',
  );
  return `${wsBase}/stream?streams=${streams}`;
}
