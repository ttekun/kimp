import { io, type Socket } from 'socket.io-client';

import {
  BITBANK_SOCKET_IO_URL,
  buildBitbankJoinRooms,
  isBitbankCircuitBreakActive,
  normalizeBitbankWsMessage,
  pairFromCircuitBreakRoom,
  resolveBitbankCoinFromPair,
} from '@kimchi/bitbank-wire';
import type { CoinSymbol } from './types';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface BitbankBrowserCallbacks {
  onTickerMessage: (raw: unknown) => void;
  onCircuitBreak: (coin: CoinSymbol, active: boolean) => void;
  onConnectionChange: (connected: boolean) => void;
}

export interface BitbankBrowserClient {
  start: () => void;
  stop: () => void;
}

export function createBitbankBrowserClient(
  callbacks: BitbankBrowserCallbacks,
): BitbankBrowserClient {
  let socket: Socket | null = null;
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

    const next = io(BITBANK_SOCKET_IO_URL, {
      transports: ['websocket'],
      reconnection: false,
    });
    socket = next;

    next.on('connect', () => {
      if (stopped || socket !== next) {
        return;
      }
      backoffMs = INITIAL_BACKOFF_MS;
      callbacks.onConnectionChange(true);
      for (const room of buildBitbankJoinRooms()) {
        next.emit('join-room', room);
      }
    });

    next.on('message', (payload: unknown) => {
      if (stopped || socket !== next) {
        return;
      }
      callbacks.onTickerMessage(payload);
      const record = payload as { room_name?: unknown; message?: { data?: { mode?: unknown } } };
      if (typeof record.room_name === 'string') {
        const pair = pairFromCircuitBreakRoom(record.room_name);
        if (pair !== null) {
          const coin = resolveBitbankCoinFromPair(pair);
          const mode = record.message?.data?.mode;
          if (coin && typeof mode === 'string') {
            callbacks.onCircuitBreak(coin, isBitbankCircuitBreakActive(mode));
          }
        }
      }
    });

    next.on('disconnect', () => {
      if (stopped || socket !== next) {
        return;
      }
      callbacks.onConnectionChange(false);
      next.removeAllListeners();
      next.disconnect();
      socket = null;
      scheduleReconnect();
    });

    next.on('connect_error', () => {
      if (stopped || socket !== next) {
        return;
      }
      callbacks.onConnectionChange(false);
      next.removeAllListeners();
      next.disconnect();
      socket = null;
      scheduleReconnect();
    });
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
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
      }
      callbacks.onConnectionChange(false);
    },
  };
}

export { normalizeBitbankWsMessage };
