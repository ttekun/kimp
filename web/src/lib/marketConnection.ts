import type { CoinSymbol, MarketSnapshot } from './types';
import type { ConnectionStatus } from '../store/marketStore';

/** Mirrors server COIN_SYMBOLS — local runtime copy because vitest cannot resolve @kimchi/server-symbols. */
const COIN_SYMBOLS = ['BTC', 'ETH', 'XRP', 'SOL', 'DOT', 'DOGE'] as const;

type AssertSameCoins =
  Exclude<CoinSymbol, (typeof COIN_SYMBOLS)[number]> extends never
    ? Exclude<(typeof COIN_SYMBOLS)[number], CoinSymbol> extends never
      ? true
      : never
    : never;
const assertWebCoinsMatchServer: AssertSameCoins = true;
void assertWebCoinsMatchServer;

/** REST fallback cadence while the WebSocket is down (docs/02-architecture.md). */
export const REST_POLL_INTERVAL_MS = 5_000;

/** WS reconnect backoff: 1 s initial, doubling each attempt, capped at 30 s. */
export const WS_RECONNECT_BASE_MS = 1_000;
export const WS_RECONNECT_MAX_MS = 30_000;

export interface MarketConnectionHandlers {
  onSnapshot: (snapshot: MarketSnapshot) => void;
  onStatusChange: (status: ConnectionStatus) => void;
}

export interface MarketConnectionOptions extends MarketConnectionHandlers {
  snapshotUrl: string;
  wsUrl: string;
  fetchFn?: typeof fetch;
  WebSocketCtor?: typeof WebSocket;
  pollIntervalMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export interface MarketConnection {
  start: () => void;
  stop: () => void;
}

type WebSocketLike = Pick<
  WebSocket,
  'close' | 'readyState' | 'onopen' | 'onmessage' | 'onclose' | 'onerror'
>;

type WebSocketCtorLike = {
  new (url: string | URL, protocols?: string | string[]): WebSocketLike;
  readonly OPEN: number;
  readonly CONNECTING: number;
  readonly CLOSING: number;
  readonly CLOSED: number;
};

/**
 * Minimal structural guard for the server→client wire shape — rejects malformed payloads
 * without crashing the client. Server-side zod schemas validate exchange ingestion input,
 * not this browser-facing snapshot contract.
 */
export function parseMarketSnapshot(payload: unknown): MarketSnapshot | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.updatedAt !== 'number' || !Number.isFinite(candidate.updatedAt)) {
    return null;
  }

  const coins = candidate.coins;
  if (coins === null || typeof coins !== 'object' || Array.isArray(coins)) {
    return null;
  }

  for (const symbol of COIN_SYMBOLS) {
    const coin = (coins as Record<string, unknown>)[symbol];
    if (coin === null || typeof coin !== 'object' || Array.isArray(coin)) {
      return null;
    }
  }

  if (candidate.fx === null || typeof candidate.fx !== 'object' || Array.isArray(candidate.fx)) {
    return null;
  }

  return payload as MarketSnapshot;
}

export function resolveMarketEndpoints(origin: string): {
  snapshotUrl: string;
  wsUrl: string;
} {
  const base = origin.replace(/\/$/, '');
  const wsProtocol = base.startsWith('https') ? 'wss' : 'ws';
  const wsHost = base.replace(/^https?:\/\//, '');

  return {
    snapshotUrl: `${base}/api/snapshot`,
    wsUrl: `${wsProtocol}://${wsHost}/ws`,
  };
}

export function createMarketConnection(options: MarketConnectionOptions): MarketConnection {
  const fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  const WebSocketCtor = (options.WebSocketCtor ?? WebSocket) as WebSocketCtorLike;
  const pollIntervalMs = options.pollIntervalMs ?? REST_POLL_INTERVAL_MS;
  const reconnectBaseMs = options.reconnectBaseMs ?? WS_RECONNECT_BASE_MS;
  const reconnectMaxMs = options.reconnectMaxMs ?? WS_RECONNECT_MAX_MS;

  let socket: WebSocketLike | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let stopped = false;
  let hasBeenLive = false;
  let isPolling = false;
  let lastAcceptedUpdatedAt = -Infinity;
  let fetchAbortController: AbortController | null = null;

  const setStatus = (status: ConnectionStatus): void => {
    if (!stopped) {
      options.onStatusChange(status);
    }
  };

  const clearPollTimer = (): void => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    isPolling = false;
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const acceptSnapshot = (snapshot: MarketSnapshot): void => {
    if (snapshot.updatedAt <= lastAcceptedUpdatedAt) {
      return;
    }

    lastAcceptedUpdatedAt = snapshot.updatedAt;
    options.onSnapshot(snapshot);
  };

  const fetchSnapshot = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    fetchAbortController?.abort();
    const abortController = new AbortController();
    fetchAbortController = abortController;

    try {
      const response = await fetchFn(options.snapshotUrl, { signal: abortController.signal });
      if (stopped) {
        return;
      }

      if (!response.ok) {
        return;
      }

      const payload: unknown = await response.json();
      if (stopped) {
        return;
      }

      const snapshot = parseMarketSnapshot(payload);
      if (snapshot === null) {
        return;
      }

      acceptSnapshot(snapshot);
    } catch {
      if (abortController.signal.aborted) {
        return;
      }
      // Network errors during fallback are expected; keep retrying via poll/reconnect.
    } finally {
      if (fetchAbortController === abortController) {
        fetchAbortController = null;
      }
    }
  };

  const startPolling = (): void => {
    if (pollTimer !== null || stopped) {
      return;
    }

    isPolling = true;
    if (hasBeenLive) {
      setStatus('reconnecting');
    } else {
      setStatus('polling');
    }

    void fetchSnapshot();

    pollTimer = setInterval(() => {
      void fetchSnapshot();
    }, pollIntervalMs);
  };

  const stopPolling = (): void => {
    if (!isPolling && pollTimer === null) {
      return;
    }

    clearPollTimer();
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer !== null) {
      return;
    }

    const delay = Math.min(reconnectBaseMs * 2 ** reconnectAttempt, reconnectMaxMs);
    reconnectAttempt += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket();
    }, delay);
  };

  const handleSocketDown = (): void => {
    socket = null;
    startPolling();
    scheduleReconnect();
  };

  const connectWebSocket = (): void => {
    if (stopped) {
      return;
    }

    if (socket !== null) {
      const state = socket.readyState;
      if (state === WebSocketCtor.OPEN || state === WebSocketCtor.CONNECTING) {
        return;
      }
    }

    if (!hasBeenLive && !isPolling) {
      setStatus('connecting');
    }

    let nextSocket: WebSocketLike;
    try {
      nextSocket = new WebSocketCtor(options.wsUrl);
    } catch {
      handleSocketDown();
      return;
    }
    socket = nextSocket;

    nextSocket.onopen = () => {
      if (stopped || socket !== nextSocket) {
        return;
      }

      clearReconnectTimer();
    };

    nextSocket.onmessage = (event: MessageEvent) => {
      if (stopped || socket !== nextSocket) {
        return;
      }

      let parsed: unknown = event.data;
      if (typeof event.data === 'string') {
        try {
          parsed = JSON.parse(event.data) as unknown;
        } catch {
          return;
        }
      }

      const snapshot = parseMarketSnapshot(parsed);
      if (snapshot === null) {
        return;
      }

      reconnectAttempt = 0;
      hasBeenLive = true;
      acceptSnapshot(snapshot);
      stopPolling();
      setStatus('live');
    };

    nextSocket.onclose = () => {
      if (stopped || socket !== nextSocket) {
        return;
      }

      handleSocketDown();
    };

    nextSocket.onerror = () => {
      if (stopped || socket !== nextSocket) {
        return;
      }

      nextSocket.close();
    };
  };

  const start = (): void => {
    stopped = false;
    hasBeenLive = false;
    reconnectAttempt = 0;
    lastAcceptedUpdatedAt = -Infinity;
    setStatus('connecting');

    void fetchSnapshot();
    connectWebSocket();
  };

  const stop = (): void => {
    stopped = true;
    fetchAbortController?.abort();
    fetchAbortController = null;
    clearPollTimer();
    clearReconnectTimer();

    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      socket = null;
    }
  };

  return { start, stop };
}
