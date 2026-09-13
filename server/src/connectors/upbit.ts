import WebSocket from 'ws';

import type { CoinSymbol } from '../core/symbols.js';
import type { Rate, UpbitTicker } from '../core/types.js';
import {
  UPBIT_SUBSCRIBE_CODES,
  UPBIT_WS_URL,
  buildUpbitRestTickerUrl,
  buildUpbitSubscribePayload as buildUpbitSubscribePayloadFromTicket,
  createUpbitSubscribeTicket,
  normalizeUpbitRestResponse,
  normalizeUpbitWireTicker,
} from './upbitWire.js';

export {
  UPBIT_REST_TICKER_URL,
  UPBIT_SUBSCRIBE_CODES,
  UPBIT_USDT_MARKET,
  UPBIT_WS_URL,
  buildUpbitRestTickerUrl,
  normalizeUpbitRestResponse,
  normalizeUpbitWireTicker,
} from './upbitWire.js';
export type { UpbitNormalizedMessage, UpbitRestBootstrapResult } from './upbitWire.js';

export const UPBIT_INITIAL_BACKOFF_MS = 1_000;
export const UPBIT_MAX_BACKOFF_MS = 30_000;
export const UPBIT_PING_INTERVAL_MS = 60_000;

const KNOWN_MARKETS = new Set<string>([...UPBIT_SUBSCRIBE_CODES]);

export type UpbitConnectorConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type UpbitConnectorErrorKind =
  'dns_tls' | 'http_error' | 'ws_protocol' | 'malformed_payload' | 'symbol_delisting';

export interface UpbitConnectorError {
  kind: UpbitConnectorErrorKind;
  message: string;
  at: number;
}

export interface UpbitConnectorHealth {
  status: UpbitConnectorConnectionStatus;
  reconnectAttempts: number;
  lastTickAt: number | null;
  lastError: UpbitConnectorError | null;
}

export interface UpbitConnectorCallbacks {
  onTicker: (coin: CoinSymbol, ticker: UpbitTicker) => void;
  onUsdtRate: (rate: Rate) => void;
}

export interface InjectableWebSocket {
  readonly readyState: number;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: WebSocket.RawData) => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'pong', listener: () => void): this;
  send(data: string | Buffer): void;
  ping(): void;
  close(): void;
  removeAllListeners(event?: string): void;
}

export type WebSocketCtor = new (url: string, protocols?: string | string[]) => InjectableWebSocket;

export type FetchFn = typeof fetch;

export interface UpbitConnectorOptions extends UpbitConnectorCallbacks {
  WebSocketCtor?: WebSocketCtor;
  fetchFn?: FetchFn;
  onMalformedMessage?: (error: UpbitConnectorError) => void;
}

export function buildUpbitSubscribePayload(): string {
  return buildUpbitSubscribePayloadFromTicket(createUpbitSubscribeTicket());
}

export function classifyUpbitNetworkError(error: unknown): UpbitConnectorError {
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

export function classifyUpbitHttpError(status: number, body: string): UpbitConnectorError {
  return {
    kind: 'http_error',
    message: `HTTP ${status}: ${body.slice(0, 200)}`,
    at: Date.now(),
  };
}

export function classifyUpbitParseFailure(raw: unknown): UpbitConnectorError {
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as { market?: unknown; code?: unknown };
    const marketCode =
      typeof record.market === 'string'
        ? record.market
        : typeof record.code === 'string'
          ? record.code
          : null;

    if (marketCode !== null && marketCode.startsWith('KRW-') && !KNOWN_MARKETS.has(marketCode)) {
      return {
        kind: 'symbol_delisting',
        message: `Unrecognized Upbit market: ${marketCode}`,
        at: Date.now(),
      };
    }
  }

  return {
    kind: 'malformed_payload',
    message: 'Malformed Upbit ticker payload',
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

export class UpbitConnector {
  private readonly callbacks: UpbitConnectorCallbacks;
  private readonly WebSocketCtor: WebSocketCtor;
  private readonly fetchFn: FetchFn;
  private readonly onMalformedMessage?: (error: UpbitConnectorError) => void;

  private ws: InjectableWebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private currentBackoffMs = UPBIT_INITIAL_BACKOFF_MS;
  private stopped = true;
  private generation = 0;

  private healthState: UpbitConnectorHealth = {
    status: 'disconnected',
    reconnectAttempts: 0,
    lastTickAt: null,
    lastError: null,
  };

  constructor(options: UpbitConnectorOptions) {
    this.callbacks = {
      onTicker: options.onTicker,
      onUsdtRate: options.onUsdtRate,
    };
    this.WebSocketCtor = options.WebSocketCtor ?? (WebSocket as unknown as WebSocketCtor);
    this.fetchFn = options.fetchFn ?? fetch;
    this.onMalformedMessage = options.onMalformedMessage;
  }

  getHealth(): UpbitConnectorHealth {
    return { ...this.healthState };
  }

  /** Parse a raw WS payload (used by tests and optional fault injection). */
  ingestRawMessage(data: WebSocket.RawData): void {
    this.handleMessage(data);
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    const run = ++this.generation;
    this.currentBackoffMs = UPBIT_INITIAL_BACKOFF_MS;
    await this.bootstrapFromRest();
    if (run === this.generation && !this.stopped) this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.clearTimers();
    this.ws?.removeAllListeners();
    this.ws?.close();
    this.ws = null;
    this.healthState = { ...this.healthState, status: 'disconnected' };
  }

  async bootstrapFromRest(): Promise<void> {
    const run = this.generation;
    const url = buildUpbitRestTickerUrl();

    let response: Response;
    try {
      response = await this.fetchFn(url, { signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      const connectorError = classifyUpbitNetworkError(error);
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        const connectorError = classifyUpbitHttpError(response.status, '');
        this.healthState = { ...this.healthState, lastError: connectorError };
        return;
      }
      const connectorError = classifyUpbitHttpError(response.status, body);
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    let raw: unknown;
    try {
      raw = (await response.json()) as unknown;
    } catch (error) {
      const connectorError: UpbitConnectorError = {
        kind: 'malformed_payload',
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      };
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    if (run !== this.generation) return;
    const { tickers, usdtRate } = normalizeUpbitRestResponse(raw);

    for (const { coin, ticker } of tickers) {
      this.callbacks.onTicker(coin, ticker);
      this.healthState = { ...this.healthState, lastTickAt: ticker.ts };
    }

    if (usdtRate) {
      this.callbacks.onUsdtRate(usdtRate);
      this.healthState = { ...this.healthState, lastTickAt: usdtRate.fetchedAt };
    }
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    this.clearWs();
    this.healthState = { ...this.healthState, status: 'connecting' };

    const ws = new this.WebSocketCtor(UPBIT_WS_URL);
    this.ws = ws;

    ws.on('open', () => {
      if (ws !== this.ws || this.stopped) return;
      this.currentBackoffMs = UPBIT_INITIAL_BACKOFF_MS;
      this.healthState = { ...this.healthState, status: 'connected', lastError: null };
      ws.send(buildUpbitSubscribePayload());
      this.startHeartbeat();
    });

    ws.on('message', (data) => {
      if (ws !== this.ws || this.stopped) return;
      this.ingestRawMessage(data);
    });

    ws.on('pong', () => {
      // Liveness signal; Upbit expects client-initiated pings (~60s).
    });

    ws.on('error', (error) => {
      if (ws !== this.ws) {
        return;
      }

      const connectorError = classifyUpbitNetworkError(error);
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
        const connectorError: UpbitConnectorError = {
          kind: 'malformed_payload',
          message: 'Invalid JSON in Upbit WebSocket message',
          at: Date.now(),
        };
        this.recordMalformed(connectorError);
        return;
      }

      const normalized = normalizeUpbitWireTicker(raw);
      if (!normalized) {
        const connectorError = classifyUpbitParseFailure(raw);
        this.recordMalformed(connectorError);
        return;
      }

      if (normalized.kind === 'coin_ticker') {
        this.callbacks.onTicker(normalized.coin, normalized.ticker);
        this.healthState = { ...this.healthState, lastTickAt: normalized.ticker.ts };
        return;
      }

      this.callbacks.onUsdtRate(normalized.rate);
      this.healthState = { ...this.healthState, lastTickAt: normalized.rate.fetchedAt };
    } catch (error) {
      const connectorError: UpbitConnectorError = {
        kind: 'malformed_payload',
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      };
      this.recordMalformed(connectorError);
    }
  }

  private recordMalformed(error: UpbitConnectorError): void {
    this.healthState = { ...this.healthState, lastError: error };
    this.onMalformedMessage?.(error);
  }

  private handleDisconnect(ws: InjectableWebSocket): void {
    if (ws !== this.ws) {
      return;
    }

    this.clearTimers();
    this.ws = null;
    ws.close();

    if (this.stopped) {
      this.healthState = { ...this.healthState, status: 'disconnected' };
      return;
    }

    this.healthState = { ...this.healthState, status: 'disconnected' };
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = this.currentBackoffMs;
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, UPBIT_MAX_BACKOFF_MS);

    this.healthState = {
      ...this.healthState,
      reconnectAttempts: this.healthState.reconnectAttempts + 1,
    };

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === 1) {
        this.ws.ping();
      }
    }, UPBIT_PING_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
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
