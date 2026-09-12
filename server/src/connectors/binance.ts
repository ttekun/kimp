import WebSocket from 'ws';

import { BINANCE_MARKET_CODES, COIN_SYMBOLS, type CoinSymbol } from '../core/symbols.js';
import type { BinanceTicker } from '../core/types.js';
import {
  BINANCE_REST_TICKER_URL_DEFAULT,
  BINANCE_WS_BASE_URL_DEFAULT,
  buildBinanceCombinedStreamUrlFromBase,
  normalizeBinanceRestResponse,
  normalizeBinanceWsMessage,
} from './binanceWire.js';

export {
  BINANCE_REST_TICKER_URL_DEFAULT,
  BINANCE_WS_BASE_URL_DEFAULT,
  normalizeBinanceRestResponse,
  normalizeBinanceWsMessage,
} from './binanceWire.js';
export type { BinanceRestBootstrapResult } from './binanceWire.js';

export const BINANCE_WS_BASE_URL = BINANCE_WS_BASE_URL_DEFAULT;
export const BINANCE_REST_TICKER_URL = BINANCE_REST_TICKER_URL_DEFAULT;

export function binanceWsBaseUrl(): string {
  return process.env.BINANCE_WS_BASE_URL ?? BINANCE_WS_BASE_URL_DEFAULT;
}

export function binanceRestTickerUrl(): string {
  return process.env.BINANCE_REST_TICKER_URL ?? BINANCE_REST_TICKER_URL_DEFAULT;
}

export const BINANCE_INITIAL_BACKOFF_MS = 1_000;
export const BINANCE_MAX_BACKOFF_MS = 30_000;
/** Binance docs: WS connections have a 24h max lifetime — reconnect proactively before server drop. */
export const BINANCE_MAX_CONNECTION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

const KNOWN_BINANCE_SYMBOLS = new Set<string>(
  COIN_SYMBOLS.map((symbol) => BINANCE_MARKET_CODES[symbol].toUpperCase()),
);

export type BinanceConnectorConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type BinanceConnectorErrorKind =
  'dns_tls' | 'http_error' | 'ws_protocol' | 'malformed_payload' | 'symbol_delisting';

export interface BinanceConnectorError {
  kind: BinanceConnectorErrorKind;
  message: string;
  at: number;
}

export interface BinanceConnectorHealth {
  status: BinanceConnectorConnectionStatus;
  reconnectAttempts: number;
  lastTickAt: number | null;
  lastError: BinanceConnectorError | null;
}

export interface BinanceConnectorCallbacks {
  onTicker: (coin: CoinSymbol, ticker: BinanceTicker) => void;
}

export interface InjectableWebSocket {
  readonly readyState: number;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: WebSocket.RawData) => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'ping', listener: () => void): this;
  close(): void;
  removeAllListeners(event?: string): void;
}

export type WebSocketCtor = new (url: string, protocols?: string | string[]) => InjectableWebSocket;

export type FetchFn = typeof fetch;

export interface BinanceConnectorOptions extends BinanceConnectorCallbacks {
  WebSocketCtor?: WebSocketCtor;
  fetchFn?: FetchFn;
  onMalformedMessage?: (error: BinanceConnectorError) => void;
}

export function buildBinanceCombinedStreamUrl(): string {
  return buildBinanceCombinedStreamUrlFromBase(binanceWsBaseUrl());
}

export function buildBinanceRestTickerUrl(): string {
  const symbols = COIN_SYMBOLS.map((symbol) => BINANCE_MARKET_CODES[symbol].toUpperCase());
  const query = encodeURIComponent(JSON.stringify(symbols));
  return `${binanceRestTickerUrl()}?symbols=${query}`;
}

export function classifyBinanceNetworkError(error: unknown): BinanceConnectorError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  const dnsTls =
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('getaddrinfo') ||
    lower.includes('certificate') ||
    lower.includes('tls') ||
    lower.includes('ssl') ||
    lower.includes('unable to verify');

  return {
    kind: dnsTls ? 'dns_tls' : 'ws_protocol',
    message,
    at: Date.now(),
  };
}

export function classifyBinanceHttpError(status: number, body: string): BinanceConnectorError {
  return {
    kind: 'http_error',
    message: `HTTP ${status}: ${body.slice(0, 200)}`,
    at: Date.now(),
  };
}

export function classifyBinanceParseFailure(raw: unknown): BinanceConnectorError {
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as { data?: { s?: unknown }; symbol?: unknown };
    const symbol =
      typeof record.data?.s === 'string'
        ? record.data.s
        : typeof record.symbol === 'string'
          ? record.symbol
          : null;

    if (symbol !== null && symbol.endsWith('USDT') && !KNOWN_BINANCE_SYMBOLS.has(symbol)) {
      return {
        kind: 'symbol_delisting',
        message: `Unrecognized Binance symbol: ${symbol}`,
        at: Date.now(),
      };
    }
  }

  return {
    kind: 'malformed_payload',
    message: 'Malformed Binance ticker payload',
    at: Date.now(),
  };
}

function parseWebSocketPayload(data: WebSocket.RawData): unknown {
  if (typeof data === 'string') {
    return JSON.parse(data) as unknown;
  }

  if (Buffer.isBuffer(data)) {
    return JSON.parse(data.toString('utf8')) as unknown;
  }

  if (Array.isArray(data)) {
    return JSON.parse(Buffer.concat(data).toString('utf8')) as unknown;
  }

  return JSON.parse(Buffer.from(data).toString('utf8')) as unknown;
}

export class BinanceConnector {
  private readonly callbacks: BinanceConnectorCallbacks;
  private readonly WebSocketCtor: WebSocketCtor;
  private readonly fetchFn: FetchFn;
  private readonly onMalformedMessage?: (error: BinanceConnectorError) => void;

  private ws: InjectableWebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  private currentBackoffMs = BINANCE_INITIAL_BACKOFF_MS;
  private stopped = true;

  private healthState: BinanceConnectorHealth = {
    status: 'disconnected',
    reconnectAttempts: 0,
    lastTickAt: null,
    lastError: null,
  };

  constructor(options: BinanceConnectorOptions) {
    this.callbacks = {
      onTicker: options.onTicker,
    };
    this.WebSocketCtor = options.WebSocketCtor ?? (WebSocket as unknown as WebSocketCtor);
    this.fetchFn = options.fetchFn ?? fetch;
    this.onMalformedMessage = options.onMalformedMessage;
  }

  getHealth(): BinanceConnectorHealth {
    return { ...this.healthState };
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.currentBackoffMs = BINANCE_INITIAL_BACKOFF_MS;
    await this.bootstrapFromRest();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.removeAllListeners();
    this.ws?.close();
    this.ws = null;
    this.healthState = { ...this.healthState, status: 'disconnected' };
  }

  async bootstrapFromRest(): Promise<void> {
    const url = buildBinanceRestTickerUrl();

    let response: Response;
    try {
      response = await this.fetchFn(url);
    } catch (error) {
      const connectorError = classifyBinanceNetworkError(error);
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        const connectorError = classifyBinanceHttpError(response.status, '');
        this.healthState = { ...this.healthState, lastError: connectorError };
        return;
      }
      const connectorError = classifyBinanceHttpError(response.status, body);
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    let raw: unknown;
    try {
      raw = (await response.json()) as unknown;
    } catch (error) {
      const connectorError: BinanceConnectorError = {
        kind: 'malformed_payload',
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      };
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    const { tickers } = normalizeBinanceRestResponse(raw);

    for (const { coin, ticker } of tickers) {
      this.callbacks.onTicker(coin, ticker);
      this.healthState = { ...this.healthState, lastTickAt: ticker.ts };
    }
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    this.clearWs();
    this.healthState = { ...this.healthState, status: 'connecting' };

    const ws = new this.WebSocketCtor(buildBinanceCombinedStreamUrl());
    this.ws = ws;

    ws.on('open', () => {
      this.currentBackoffMs = BINANCE_INITIAL_BACKOFF_MS;
      this.healthState = { ...this.healthState, status: 'connected', lastError: null };
      this.scheduleLifetimeReconnect();
    });

    ws.on('message', (data) => {
      this.handleMessage(data);
    });

    ws.on('ping', () => {
      // Binance server sends ping frames; the native `ws` client auto-responds with pong
      // unless disableAutoPong is set. Listener retained for liveness observability.
    });

    ws.on('error', (error) => {
      if (ws !== this.ws) {
        return;
      }

      const connectorError = classifyBinanceNetworkError(error);
      this.healthState = { ...this.healthState, lastError: connectorError };
      this.handleDisconnect(ws);
    });

    ws.on('close', () => {
      if (ws !== this.ws) {
        return;
      }

      this.handleDisconnect(ws);
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      let raw: unknown;
      try {
        raw = parseWebSocketPayload(data);
      } catch {
        const connectorError: BinanceConnectorError = {
          kind: 'malformed_payload',
          message: 'Invalid JSON in Binance WebSocket message',
          at: Date.now(),
        };
        this.recordMalformed(connectorError);
        return;
      }

      const normalized = normalizeBinanceWsMessage(raw);
      if (!normalized) {
        const connectorError = classifyBinanceParseFailure(raw);
        this.recordMalformed(connectorError);
        return;
      }

      this.callbacks.onTicker(normalized.coin, normalized.ticker);
      this.healthState = { ...this.healthState, lastTickAt: normalized.ticker.ts };
    } catch (error) {
      const connectorError: BinanceConnectorError = {
        kind: 'malformed_payload',
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      };
      this.recordMalformed(connectorError);
    }
  }

  private recordMalformed(error: BinanceConnectorError): void {
    this.healthState = { ...this.healthState, lastError: error };
    this.onMalformedMessage?.(error);
  }

  private handleDisconnect(ws: InjectableWebSocket): void {
    if (ws !== this.ws) {
      return;
    }

    this.clearTimers();
    this.ws = null;

    if (this.stopped) {
      this.healthState = { ...this.healthState, status: 'disconnected' };
      return;
    }

    this.healthState = { ...this.healthState, status: 'disconnected' };
    this.scheduleReconnect();
  }

  private scheduleProactiveReconnect(): void {
    if (this.stopped) {
      return;
    }

    this.clearTimers();
    this.clearWs();
    this.connect();
  }

  private scheduleLifetimeReconnect(): void {
    if (this.lifetimeTimer) {
      clearTimeout(this.lifetimeTimer);
    }

    this.lifetimeTimer = setTimeout(() => {
      this.lifetimeTimer = null;
      this.scheduleProactiveReconnect();
    }, BINANCE_MAX_CONNECTION_LIFETIME_MS);
  }

  private scheduleReconnect(): void {
    const delay = this.currentBackoffMs;
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, BINANCE_MAX_BACKOFF_MS);

    this.healthState = {
      ...this.healthState,
      reconnectAttempts: this.healthState.reconnectAttempts + 1,
    };

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.lifetimeTimer) {
      clearTimeout(this.lifetimeTimer);
      this.lifetimeTimer = null;
    }
  }

  private clearWs(): void {
    if (!this.ws) {
      return;
    }

    this.ws.removeAllListeners();
    this.ws.close();
    this.ws = null;
  }
}
