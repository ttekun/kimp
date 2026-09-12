import { rateSchema, upbitTickerSchema } from '../core/schemas.js';
import { COIN_SYMBOLS, UPBIT_MARKET_CODES, type CoinSymbol } from '../core/symbols.js';
import type { Rate, UpbitTicker } from '../core/types.js';
import {
  resolveUpbitWireMarketCode,
  upbitRestTickerArraySchema,
  upbitWireTickerSchema,
  type UpbitWireTicker,
} from './upbitSchemas.js';

export const UPBIT_WS_URL = 'wss://api.upbit.com/websocket/v1';
export const UPBIT_REST_TICKER_URL = 'https://api.upbit.com/v1/ticker';
export const UPBIT_USDT_MARKET = 'KRW-USDT';

export const UPBIT_SUBSCRIBE_CODES = [
  ...COIN_SYMBOLS.map((symbol) => UPBIT_MARKET_CODES[symbol]),
  UPBIT_USDT_MARKET,
] as const;

const UPBIT_MARKET_TO_COIN = Object.fromEntries(
  COIN_SYMBOLS.map((symbol) => [UPBIT_MARKET_CODES[symbol], symbol]),
) as Record<string, CoinSymbol>;

const PLACEHOLDER_TICKER_STATUS = 'live' as const;

export type UpbitNormalizedMessage =
  | { kind: 'coin_ticker'; coin: CoinSymbol; ticker: UpbitTicker }
  | { kind: 'usdt_rate'; rate: Rate };

export interface UpbitRestBootstrapResult {
  tickers: Array<{ coin: CoinSymbol; ticker: UpbitTicker }>;
  usdtRate: Rate | null;
}

function formatRatesDate(wire: UpbitWireTicker): string {
  if (wire.trade_date && /^\d{8}$/.test(wire.trade_date)) {
    return `${wire.trade_date.slice(0, 4)}-${wire.trade_date.slice(4, 6)}-${wire.trade_date.slice(6, 8)}`;
  }

  return new Date(wire.timestamp).toISOString().slice(0, 10);
}

function wireToUpbitTicker(wire: UpbitWireTicker): UpbitTicker | null {
  const ticker: UpbitTicker = {
    price: wire.trade_price,
    change24hPct: wire.signed_change_rate * 100,
    volume24hKrw: wire.acc_trade_price_24h,
    ts: wire.timestamp,
    status: PLACEHOLDER_TICKER_STATUS,
  };

  const parsed = upbitTickerSchema.safeParse(ticker);
  return parsed.success ? parsed.data : null;
}

function wireToUsdtRate(wire: UpbitWireTicker): Rate | null {
  const rate: Rate = {
    value: wire.trade_price,
    fetchedAt: wire.timestamp,
    source: 'upbit',
    ratesDate: formatRatesDate(wire),
  };

  const parsed = rateSchema.safeParse(rate);
  return parsed.success ? parsed.data : null;
}

export function normalizeUpbitWireTicker(raw: unknown): UpbitNormalizedMessage | null {
  const parsed = upbitWireTickerSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const wire = parsed.data;
  const marketCode = resolveUpbitWireMarketCode(wire);

  if (marketCode === UPBIT_USDT_MARKET) {
    const rate = wireToUsdtRate(wire);
    return rate ? { kind: 'usdt_rate', rate } : null;
  }

  const coin = UPBIT_MARKET_TO_COIN[marketCode];
  if (!coin) {
    return null;
  }

  const ticker = wireToUpbitTicker(wire);
  return ticker ? { kind: 'coin_ticker', coin, ticker } : null;
}

export function normalizeUpbitRestResponse(raw: unknown): UpbitRestBootstrapResult {
  const parsed = upbitRestTickerArraySchema.safeParse(raw);
  if (!parsed.success) {
    return { tickers: [], usdtRate: null };
  }

  const tickers: Array<{ coin: CoinSymbol; ticker: UpbitTicker }> = [];
  let usdtRate: Rate | null = null;

  for (const item of parsed.data) {
    const normalized = normalizeUpbitWireTicker(item);
    if (!normalized) {
      continue;
    }

    if (normalized.kind === 'coin_ticker') {
      tickers.push({ coin: normalized.coin, ticker: normalized.ticker });
      continue;
    }

    usdtRate = normalized.rate;
  }

  return { tickers, usdtRate };
}

export function buildUpbitSubscribePayload(ticket: string): string {
  return JSON.stringify([
    { ticket },
    { type: 'ticker', codes: [...UPBIT_SUBSCRIBE_CODES] },
    { format: 'DEFAULT' },
  ]);
}

export function createUpbitSubscribeTicket(): string {
  return globalThis.crypto.randomUUID();
}

export function buildUpbitRestTickerUrl(): string {
  const markets = UPBIT_SUBSCRIBE_CODES.join(',');
  return `${UPBIT_REST_TICKER_URL}?markets=${markets}`;
}
