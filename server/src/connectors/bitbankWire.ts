import { bitbankTickerSchema } from '../core/schemas.js';
import { BITBANK_MARKET_CODES, COIN_SYMBOLS, type CoinSymbol } from '../core/symbols.js';
import type { BitbankTicker } from '../core/types.js';
import {
  bitbankRestTickersEnvelopeSchema,
  bitbankWireTickerRowSchema,
  bitbankWsTickerMessageSchema,
  type BitbankWireTickerData,
} from './bitbankSchemas.js';

export { bitbankCircuitBreakWsMessageSchema } from './bitbankSchemas.js';

export const BITBANK_SOCKET_IO_URL = 'wss://stream.bitbank.cc';

const BITBANK_PAIR_TO_COIN = Object.fromEntries(
  COIN_SYMBOLS.map((symbol) => [BITBANK_MARKET_CODES[symbol], symbol]),
) as Record<string, CoinSymbol>;

const KNOWN_BITBANK_PAIRS = new Set<string>(Object.keys(BITBANK_PAIR_TO_COIN));

const PLACEHOLDER_TICKER_STATUS = 'live' as const;

export type BitbankBookUnusableReason = 'one_sided' | 'crossed';

export type BitbankTickerNormalizeResult =
  | { kind: 'ticker'; coin: CoinSymbol; ticker: BitbankTicker }
  | { kind: 'book_unusable'; coin: CoinSymbol; reason: BitbankBookUnusableReason; ts: number }
  | null;

export interface BitbankRestBootstrapResult {
  tickers: Array<{ coin: CoinSymbol; ticker: BitbankTicker }>;
}

export function resolveBitbankCoinFromPair(pair: string): CoinSymbol | null {
  return Object.hasOwn(BITBANK_PAIR_TO_COIN, pair) ? BITBANK_PAIR_TO_COIN[pair]! : null;
}

function parseBitbankNumericString(value: string): number | null {
  const parsed = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)
    ? Number(value)
    : NaN;
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function evaluateBitbankBook(
  buyRaw: string | null | undefined,
  sellRaw: string | null | undefined,
): number | BitbankBookUnusableReason | null {
  if (buyRaw == null || sellRaw == null) {
    return 'one_sided';
  }

  const buy = parseBitbankNumericString(buyRaw);
  const sell = parseBitbankNumericString(sellRaw);

  if (buy === null || sell === null) {
    return null;
  }

  if (buy <= 0 || sell <= 0) {
    return 'one_sided';
  }

  if (buy > sell) {
    return 'crossed';
  }

  return (buy + sell) / 2;
}

function wireToBitbankTicker(midPrice: number, ts: number): BitbankTicker | null {
  const ticker: BitbankTicker = {
    price: midPrice,
    ts,
    status: PLACEHOLDER_TICKER_STATUS,
  };

  const parsed = bitbankTickerSchema.safeParse(ticker);
  return parsed.success ? parsed.data : null;
}

function normalizeWireTickerData(
  data: BitbankWireTickerData,
  pair: string,
): BitbankTickerNormalizeResult {
  const coin = resolveBitbankCoinFromPair(pair);
  if (!coin) {
    return null;
  }

  const book = evaluateBitbankBook(data.buy, data.sell);
  if (book === null) {
    return null;
  }

  if (book === 'one_sided' || book === 'crossed') {
    return { kind: 'book_unusable', coin, reason: book, ts: data.timestamp };
  }

  const ticker = wireToBitbankTicker(book, data.timestamp);
  return ticker ? { kind: 'ticker', coin, ticker } : null;
}

function pairFromTickerRoom(roomName: string): string | null {
  const prefix = 'ticker_';
  if (!roomName.startsWith(prefix)) {
    return null;
  }

  const pair = roomName.slice(prefix.length);
  return KNOWN_BITBANK_PAIRS.has(pair) ? pair : null;
}

export function pairFromCircuitBreakRoom(roomName: string): string | null {
  const prefix = 'circuit_break_info_';
  if (!roomName.startsWith(prefix)) {
    return null;
  }

  const pair = roomName.slice(prefix.length);
  return KNOWN_BITBANK_PAIRS.has(pair) ? pair : null;
}

export function isBitbankCircuitBreakActive(mode: string): boolean {
  return mode !== 'NONE';
}

export function isBitbankMarketStatusDown(status: string): boolean {
  return status !== 'NORMAL';
}

export function normalizeBitbankWsMessage(raw: unknown): BitbankTickerNormalizeResult {
  const parsed = bitbankWsTickerMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const pair = pairFromTickerRoom(parsed.data.room_name);
  if (!pair) {
    return null;
  }

  return normalizeWireTickerData(parsed.data.message.data, pair);
}

function extractBitbankPairFromRawRow(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) {
    return null;
  }

  const pair = (row as { pair?: unknown }).pair;
  return typeof pair === 'string' ? pair : null;
}

export function normalizeBitbankRestTickersResponse(raw: unknown): BitbankRestBootstrapResult {
  const envelope = bitbankRestTickersEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return { tickers: [] };
  }

  const tickers: Array<{ coin: CoinSymbol; ticker: BitbankTicker }> = [];

  for (const rowRaw of envelope.data.data) {
    const pair = extractBitbankPairFromRawRow(rowRaw);
    if (!pair || !KNOWN_BITBANK_PAIRS.has(pair)) {
      continue;
    }

    const parsed = bitbankWireTickerRowSchema.safeParse(rowRaw);
    if (!parsed.success) {
      continue;
    }

    const normalized = normalizeWireTickerData(parsed.data, pair);
    if (normalized?.kind === 'ticker') {
      tickers.push({ coin: normalized.coin, ticker: normalized.ticker });
    }
  }

  return { tickers };
}

export function buildBitbankTickerRoom(pair: string): string {
  return `ticker_${pair}`;
}

export function buildBitbankCircuitBreakRoom(pair: string): string {
  return `circuit_break_info_${pair}`;
}

export function buildBitbankJoinRooms(): string[] {
  return COIN_SYMBOLS.flatMap((symbol) => {
    const pair = BITBANK_MARKET_CODES[symbol];
    return [buildBitbankTickerRoom(pair), buildBitbankCircuitBreakRoom(pair)];
  });
}

export function tickerPairFromBitbankRoom(roomName: string): string | null {
  return pairFromTickerRoom(roomName);
}
