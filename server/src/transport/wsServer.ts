import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

import type { MarketSnapshot } from '../core/types.js';

/** Coalesced broadcast cadence — at most one full snapshot per client per interval. */
export const WS_BROADCAST_INTERVAL_MS = 1_000;

/**
 * If a client's kernel buffer still holds data from the previous push, skip the next push
 * rather than queueing another full snapshot (coalescing + backpressure).
 * If buffered bytes exceed this threshold, disconnect the slow client.
 */
export const WS_MAX_BUFFERED_BYTES = 64 * 1_024;

/**
 * Disconnect a client that has been skipped this many broadcast ticks in a row because
 * its kernel buffer never drained (bufferedAmount > 0 but below WS_MAX_BUFFERED_BYTES).
 * At 1 Hz this is ~30 s — long enough to tolerate brief backpressure, short enough to
 * evict permanently stalled clients before they become silent zombies.
 */
export const WS_MAX_CONSECUTIVE_SKIPS = 30;

export interface WsBroadcasterDeps {
  getSnapshot: () => MarketSnapshot;
  broadcastIntervalMs?: number;
}

export interface WsBroadcaster {
  addClient: (socket: WebSocket) => void;
  removeClient: (socket: WebSocket) => void;
  getClientCount: () => number;
  destroy: () => void;
}

function isSocketOpen(socket: WebSocket): boolean {
  return socket.readyState === socket.OPEN;
}

/**
 * Shared 1 Hz broadcast loop: one serialization per tick, fan-out to all connected clients.
 * Connect sends an immediate snapshot so the first paint does not wait for the next tick.
 */
export function createWsBroadcaster(deps: WsBroadcasterDeps): WsBroadcaster {
  const clients = new Set<WebSocket>();
  const consecutiveSkips = new WeakMap<WebSocket, number>();
  const intervalMs = deps.broadcastIntervalMs ?? WS_BROADCAST_INTERVAL_MS;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stopBroadcastLoop = (): void => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const ensureBroadcastLoop = (): void => {
    if (intervalId !== null || clients.size === 0) {
      return;
    }

    intervalId = setInterval(() => {
      broadcast();
    }, intervalMs);
  };

  const removeClient = (socket: WebSocket): void => {
    if (!clients.has(socket)) {
      return;
    }

    clients.delete(socket);
    consecutiveSkips.delete(socket);
    if (clients.size === 0) {
      stopBroadcastLoop();
    }
  };

  const disconnectForBackpressure = (socket: WebSocket): void => {
    socket.close(1008, 'backpressure');
    removeClient(socket);
  };

  const sendPayload = (socket: WebSocket, payload: string): void => {
    if (!isSocketOpen(socket)) {
      removeClient(socket);
      return;
    }

    if (socket.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
      disconnectForBackpressure(socket);
      return;
    }

    if (socket.bufferedAmount > 0) {
      const skips = (consecutiveSkips.get(socket) ?? 0) + 1;
      if (skips >= WS_MAX_CONSECUTIVE_SKIPS) {
        disconnectForBackpressure(socket);
        return;
      }
      consecutiveSkips.set(socket, skips);
      return;
    }

    consecutiveSkips.set(socket, 0);

    try {
      socket.send(payload);
    } catch {
      removeClient(socket);
    }
  };

  const broadcast = (): void => {
    if (clients.size === 0) {
      stopBroadcastLoop();
      return;
    }

    const payload = JSON.stringify(deps.getSnapshot());

    for (const socket of clients) {
      sendPayload(socket, payload);
    }
  };

  const addClient = (socket: WebSocket): void => {
    clients.add(socket);
    sendPayload(socket, JSON.stringify(deps.getSnapshot()));
    ensureBroadcastLoop();

    socket.on('close', () => {
      removeClient(socket);
    });

    socket.on('error', () => {
      removeClient(socket);
    });
  };

  const destroy = (): void => {
    stopBroadcastLoop();
    for (const socket of clients) {
      if (isSocketOpen(socket)) {
        socket.close();
      }
    }
    clients.clear();
  };

  return {
    addClient,
    removeClient,
    getClientCount: () => clients.size,
    destroy,
  };
}

export interface RegisterWsBroadcasterDeps {
  getSnapshot: () => MarketSnapshot;
  broadcastIntervalMs?: number;
}

/**
 * Registers `@fastify/websocket` and the `/ws` route on the same Fastify instance as HTTP.
 * Uses a shared broadcaster timer so all clients receive the same coalesced 1 Hz payload.
 */
export async function registerWsBroadcaster(
  app: FastifyInstance,
  deps: RegisterWsBroadcasterDeps,
): Promise<WsBroadcaster> {
  const broadcaster = createWsBroadcaster({
    getSnapshot: deps.getSnapshot,
    broadcastIntervalMs: deps.broadcastIntervalMs,
  });

  await app.register(websocket);

  app.get('/ws', { websocket: true }, (socket) => {
    broadcaster.addClient(socket);
  });

  app.addHook('onClose', async () => {
    broadcaster.destroy();
  });

  return broadcaster;
}
