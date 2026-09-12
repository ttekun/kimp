import { io } from 'socket.io-client';

import type { CoinSymbol } from '../core/symbols.js';
import type { BitbankTicker } from '../core/types.js';
import {
  bitbankCircuitBreakWsMessageSchema,
  bitbankMarketStatusResponseSchema,
  type BitbankCircuitBreakWsMessage,
} from './bitbankSchemas.js';
import {
  BITBANK_SOCKET_IO_URL,
  buildBitbankJoinRooms,
  isBitbankCircuitBreakActive,
  isBitbankMarketStatusDown,
  normalizeBitbankRestTickersResponse,
  normalizeBitbankWsMessage,
  pairFromCircuitBreakRoom,
  resolveBitbankCoinFromPair,
  tickerPairFromBitbankRoom,
  type BitbankBookUnusableReason,
} from './bitbankWire.js';

export {
  BITBANK_SOCKET_IO_URL,
  buildBitbankCircuitBreakRoom,
  buildBitbankJoinRooms,
  buildBitbankTickerRoom,
  evaluateBitbankBook,
  isBitbankCircuitBreakActive,
  isBitbankMarketStatusDown,
  normalizeBitbankRestTickersResponse,
  normalizeBitbankWsMessage,
} from './bitbankWire.js';
export type {
  BitbankBookUnusableReason,
  BitbankRestBootstrapResult,
  BitbankTickerNormalizeResult,
} from './bitbankWire.js';

export const BITBANK_REST_TICKERS_URL = 'https://public.bitbank.cc/tickers';
export const BITBANK_REST_MARKET_STATUS_URL = 'https://api.bitbank.cc/v1/spot/status';

export const BITBANK_INITIAL_BACKOFF_MS = 1_000;
export const BITBANK_MAX_BACKOFF_MS = 30_000;

export type BitbankConnectorConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type BitbankConnectorErrorKind =
  'dns_tls' | 'http_error' | 'socket_protocol' | 'malformed_payload' | 'symbol_delisting';

export interface BitbankConnectorError {
  kind: BitbankConnectorErrorKind;
  message: string;
  at: number;
}

export interface BitbankConnectorHealth {
  status: BitbankConnectorConnectionStatus;
  reconnectAttempts: number;
  lastTickAt: number | null;
  lastError: BitbankConnectorError | null;
}

export interface BitbankConnectorCallbacks {
  onTicker: (coin: CoinSymbol, ticker: BitbankTicker) => void;
  /** Fired when a tick is parsed but the book is one-sided or crossed — no mid-price is emitted. */
  onBookUnusable?: (coin: CoinSymbol, reason: BitbankBookUnusableReason) => void;
}

export interface InjectableSocketIoClient {
  readonly connected: boolean;
  on(event: 'connect', listener: () => void): this;
  on(event: 'disconnect', listener: (reason: string) => void): this;
  on(event: 'connect_error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (payload: unknown) => void): this;
  emit(event: 'join-room', room: string): this;
  removeAllListeners(event?: string): this;
  disconnect(): void;
}

export type SocketIoClientFactory = (
  url: string,
  options?: Record<string, unknown>,
) => InjectableSocketIoClient;

export type FetchFn = typeof fetch;

export interface BitbankConnectorOptions extends BitbankConnectorCallbacks {
  socketIoClientFactory?: SocketIoClientFactory;
  fetchFn?: FetchFn;
  onMalformedMessage?: (error: BitbankConnectorError) => void;
}

export function classifyBitbankNetworkError(error: unknown): BitbankConnectorError {
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
    kind: dnsTls ? 'dns_tls' : 'socket_protocol',
    message,
    at: Date.now(),
  };
}

export function classifyBitbankHttpError(status: number, body: string): BitbankConnectorError {
  return {
    kind: 'http_error',
    message: `HTTP ${status}: ${body.slice(0, 200)}`,
    at: Date.now(),
  };
}

export function classifyBitbankParseFailure(raw: unknown): BitbankConnectorError {
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as { room_name?: unknown };
    if (typeof record.room_name === 'string') {
      const pair = tickerPairFromBitbankRoom(record.room_name);
      if (pair === null && record.room_name.startsWith('ticker_')) {
        return {
          kind: 'symbol_delisting',
          message: `Unrecognized Bitbank ticker room: ${record.room_name}`,
          at: Date.now(),
        };
      }
    }
  }

  return {
    kind: 'malformed_payload',
    message: 'Malformed Bitbank ticker payload',
    at: Date.now(),
  };
}

function defaultSocketIoClientFactory(
  url: string,
  options?: Record<string, unknown>,
): InjectableSocketIoClient {
  return io(url, {
    transports: ['websocket'],
    reconnection: false,
    ...options,
  }) as unknown as InjectableSocketIoClient;
}

export class BitbankConnector {
  private readonly callbacks: BitbankConnectorCallbacks;
  private readonly socketIoClientFactory: SocketIoClientFactory;
  private readonly fetchFn: FetchFn;
  private readonly onMalformedMessage?: (error: BitbankConnectorError) => void;

  private socket: InjectableSocketIoClient | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentBackoffMs = BITBANK_INITIAL_BACKOFF_MS;
  private stopped = true;
  private disconnectHandled = false;

  private readonly circuitBreakActive = new Map<CoinSymbol, boolean>();
  private readonly marketStatusDown = new Map<CoinSymbol, boolean>();

  private healthState: BitbankConnectorHealth = {
    status: 'disconnected',
    reconnectAttempts: 0,
    lastTickAt: null,
    lastError: null,
  };

  constructor(options: BitbankConnectorOptions) {
    this.callbacks = {
      onTicker: options.onTicker,
      onBookUnusable: options.onBookUnusable,
    };
    this.socketIoClientFactory = options.socketIoClientFactory ?? defaultSocketIoClientFactory;
    this.fetchFn = options.fetchFn ?? fetch;
    this.onMalformedMessage = options.onMalformedMessage;
  }

  getHealth(): BitbankConnectorHealth {
    return { ...this.healthState };
  }

  isCoinSuppressed(coin: CoinSymbol): boolean {
    return this.circuitBreakActive.get(coin) === true || this.marketStatusDown.get(coin) === true;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.currentBackoffMs = BITBANK_INITIAL_BACKOFF_MS;
    await this.bootstrapFromRest();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.clearSocket();
    this.healthState = { ...this.healthState, status: 'disconnected' };
  }

  async bootstrapFromRest(): Promise<void> {
    await this.bootstrapMarketStatus();
    await this.bootstrapTickers();
  }

  private async bootstrapMarketStatus(): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(BITBANK_REST_MARKET_STATUS_URL);
    } catch (error) {
      const connectorError = classifyBitbankNetworkError(error);
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        const connectorError = classifyBitbankHttpError(response.status, '');
        this.healthState = { ...this.healthState, lastError: connectorError };
        return;
      }
      const connectorError = classifyBitbankHttpError(response.status, body);
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    let raw: unknown;
    try {
      raw = (await response.json()) as unknown;
    } catch (error) {
      const connectorError: BitbankConnectorError = {
        kind: 'malformed_payload',
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      };
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    this.applyMarketStatusBootstrap(raw);
  }

  private applyMarketStatusBootstrap(raw: unknown): void {
    const parsed = bitbankMarketStatusResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return;
    }

    for (const row of parsed.data.data.statuses) {
      const coin = resolveBitbankCoinFromPair(row.pair);
      if (!coin) {
        continue;
      }

      this.marketStatusDown.set(coin, isBitbankMarketStatusDown(row.status));
    }
  }

  private async bootstrapTickers(): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(BITBANK_REST_TICKERS_URL);
    } catch (error) {
      const connectorError = classifyBitbankNetworkError(error);
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        const connectorError = classifyBitbankHttpError(response.status, '');
        this.healthState = { ...this.healthState, lastError: connectorError };
        return;
      }
      const connectorError = classifyBitbankHttpError(response.status, body);
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    let raw: unknown;
    try {
      raw = (await response.json()) as unknown;
    } catch (error) {
      const connectorError: BitbankConnectorError = {
        kind: 'malformed_payload',
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      };
      this.healthState = { ...this.healthState, lastError: connectorError };
      return;
    }

    const { tickers } = normalizeBitbankRestTickersResponse(raw);

    for (const { coin, ticker } of tickers) {
      if (this.isCoinSuppressed(coin)) {
        continue;
      }

      this.callbacks.onTicker(coin, ticker);
      this.healthState = { ...this.healthState, lastTickAt: ticker.ts };
    }
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    this.clearSocket();
    this.disconnectHandled = false;
    this.healthState = { ...this.healthState, status: 'connecting' };

    const socket = this.socketIoClientFactory(BITBANK_SOCKET_IO_URL, {
      reconnection: false,
    });
    this.socket = socket;

    socket.on('connect', () => {
      if (socket !== this.socket) {
        return;
      }

      this.currentBackoffMs = BITBANK_INITIAL_BACKOFF_MS;
      this.healthState = { ...this.healthState, status: 'connected', lastError: null };
      this.joinRooms(socket);
    });

    socket.on('message', (payload) => {
      if (socket !== this.socket) {
        return;
      }

      this.handleMessage(payload);
    });

    socket.on('connect_error', (error) => {
      if (socket !== this.socket) {
        return;
      }

      const connectorError = classifyBitbankNetworkError(error);
      this.healthState = { ...this.healthState, lastError: connectorError };
      this.handleDisconnect(socket);
    });

    socket.on('disconnect', () => {
      if (socket !== this.socket) {
        return;
      }

      this.handleDisconnect(socket);
    });
  }

  private joinRooms(socket: InjectableSocketIoClient): void {
    for (const room of buildBitbankJoinRooms()) {
      socket.emit('join-room', room);
    }
  }

  private handleMessage(payload: unknown): void {
    const circuitParsed = bitbankCircuitBreakWsMessageSchema.safeParse(payload);
    if (circuitParsed.success) {
      this.handleCircuitBreakMessage(circuitParsed.data);
      return;
    }

    const normalized = normalizeBitbankWsMessage(payload);
    if (!normalized) {
      const connectorError = classifyBitbankParseFailure(payload);
      this.recordMalformed(connectorError);
      return;
    }

    if (normalized.kind === 'book_unusable') {
      this.callbacks.onBookUnusable?.(normalized.coin, normalized.reason);
      return;
    }

    if (this.isCoinSuppressed(normalized.coin)) {
      return;
    }

    this.callbacks.onTicker(normalized.coin, normalized.ticker);
    this.healthState = { ...this.healthState, lastTickAt: normalized.ticker.ts };
  }

  private handleCircuitBreakMessage(message: BitbankCircuitBreakWsMessage): void {
    const pair = pairFromCircuitBreakRoom(message.room_name);
    if (!pair) {
      return;
    }

    const coin = resolveBitbankCoinFromPair(pair);
    if (!coin) {
      return;
    }

    this.circuitBreakActive.set(coin, isBitbankCircuitBreakActive(message.message.data.mode));
  }

  private recordMalformed(error: BitbankConnectorError): void {
    this.healthState = { ...this.healthState, lastError: error };
    this.onMalformedMessage?.(error);
  }

  private handleDisconnect(socket: InjectableSocketIoClient): void {
    if (socket !== this.socket) {
      return;
    }

    if (this.disconnectHandled) {
      return;
    }
    this.disconnectHandled = true;

    this.clearReconnectTimer();
    this.clearSocket();

    if (this.stopped) {
      this.healthState = { ...this.healthState, status: 'disconnected' };
      return;
    }

    this.healthState = { ...this.healthState, status: 'disconnected' };
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = this.currentBackoffMs;
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, BITBANK_MAX_BACKOFF_MS);

    this.healthState = {
      ...this.healthState,
      reconnectAttempts: this.healthState.reconnectAttempts + 1,
    };

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearSocket(): void {
    if (!this.socket) {
      return;
    }

    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }
}
