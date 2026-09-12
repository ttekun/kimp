import {
  BINANCE_BROWSER_WS_BASE_URL,
  buildBinanceCombinedStreamUrlFromBase,
  normalizeBinanceWsMessage,
} from '@kimchi/binance-wire';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface BinanceBrowserCallbacks {
  onMessage: (raw: unknown) => void;
  onConnectionChange: (connected: boolean) => void;
}

export interface BinanceBrowserClient {
  start: () => void;
  stop: () => void;
}

export function createBinanceBrowserClient(
  callbacks: BinanceBrowserCallbacks,
  WebSocketCtor: typeof WebSocket = WebSocket,
): BinanceBrowserClient {
  let socket: WebSocket | null = null;
  let stopped = true;
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnect = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer !== null) {
      return;
    }
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = (): void => {
    if (stopped) {
      return;
    }

    const url = buildBinanceCombinedStreamUrlFromBase(BINANCE_BROWSER_WS_BASE_URL);
    let next: WebSocket;
    try {
      next = new WebSocketCtor(url);
    } catch {
      callbacks.onConnectionChange(false);
      scheduleReconnect();
      return;
    }

    socket = next;

    next.onopen = () => {
      if (stopped || socket !== next) {
        return;
      }
      backoffMs = INITIAL_BACKOFF_MS;
      callbacks.onConnectionChange(true);
    };

    next.onmessage = (event: MessageEvent) => {
      if (stopped || socket !== next) {
        return;
      }
      let raw: unknown = event.data;
      if (typeof event.data === 'string') {
        try {
          raw = JSON.parse(event.data) as unknown;
        } catch {
          return;
        }
      }
      callbacks.onMessage(raw);
    };

    next.onclose = () => {
      if (stopped || socket !== next) {
        return;
      }
      socket = null;
      callbacks.onConnectionChange(false);
      scheduleReconnect();
    };

    next.onerror = () => {
      next.close();
    };
  };

  return {
    start: () => {
      stopped = false;
      backoffMs = INITIAL_BACKOFF_MS;
      connect();
    },
    stop: () => {
      stopped = true;
      clearReconnect();
      if (socket !== null) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
        socket = null;
      }
      callbacks.onConnectionChange(false);
    },
  };
}

export { normalizeBinanceWsMessage };
