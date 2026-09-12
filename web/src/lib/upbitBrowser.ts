import {
  UPBIT_WS_URL,
  buildUpbitSubscribePayload,
  createUpbitSubscribeTicket,
  normalizeUpbitWireTicker,
} from '@kimchi/upbit-wire';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface UpbitBrowserCallbacks {
  onMessage: (raw: unknown) => void;
  onConnectionChange: (connected: boolean) => void;
}

export interface UpbitBrowserClient {
  start: () => void;
  stop: () => void;
}

export function createUpbitBrowserClient(
  callbacks: UpbitBrowserCallbacks,
  WebSocketCtor: typeof WebSocket = WebSocket,
): UpbitBrowserClient {
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

    let next: WebSocket;
    try {
      next = new WebSocketCtor(UPBIT_WS_URL);
    } catch {
      callbacks.onConnectionChange(false);
      scheduleReconnect();
      return;
    }

    next.binaryType = 'arraybuffer';
    socket = next;

    next.onopen = () => {
      if (stopped || socket !== next) {
        return;
      }
      backoffMs = INITIAL_BACKOFF_MS;
      callbacks.onConnectionChange(true);
      next.send(buildUpbitSubscribePayload(createUpbitSubscribeTicket()));
    };

    next.onmessage = (event: MessageEvent) => {
      if (stopped || socket !== next) {
        return;
      }
      void decodeUpbitPayload(event.data).then((raw) => {
        if (raw !== null) {
          callbacks.onMessage(raw);
        }
      });
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

export async function decodeUpbitPayload(data: unknown): Promise<unknown | null> {
  try {
    if (typeof data === 'string') {
      return JSON.parse(data) as unknown;
    }
    if (data instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder().decode(data)) as unknown;
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return JSON.parse(await data.text()) as unknown;
    }
    return null;
  } catch {
    return null;
  }
}

export { normalizeUpbitWireTicker };
