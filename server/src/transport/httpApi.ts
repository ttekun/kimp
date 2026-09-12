import path from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import type { MarketSnapshot } from '../core/types.js';
import type { HealthSummary } from './health.js';
import { securityHeaders } from './securityHeaders.js';
import { registerWsBroadcaster } from './wsServer.js';

export interface HttpApiDeps {
  /**
   * Returns a snapshot with staleness/premium state derived at read time.
   * The caller must apply `recomputeSnapshot(rawSnapshot, Date.now())` before returning.
   */
  getSnapshot: () => MarketSnapshot;
  getHealth: () => HealthSummary;
  staticRoot: string;
  /** Test-only override for WS coalescing cadence (default 1 s). */
  wsBroadcastIntervalMs?: number;
  /** Extra routes registered after /api/health and before static (e.g. fault injection). */
  registerExtraRoutes?: (app: FastifyInstance) => void | Promise<void>;
}

/**
 * Builds a Fastify app with API routes and static SPA serving.
 * API routes are registered before static middleware so `/api/*` is never shadowed.
 */
export async function buildHttpApi(deps: HttpApiDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onSend', async (_request, reply) => {
    const headers = securityHeaders();
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) {
        void reply.header(name, value);
      }
    }
  });

  app.get('/api/snapshot', async (_request, reply) => {
    const snapshot = deps.getSnapshot();
    return reply.type('application/json').send(snapshot);
  });

  app.get('/api/health', async (_request, reply) => {
    const health = deps.getHealth();
    return reply.type('application/json').send(health);
  });

  if (deps.registerExtraRoutes) {
    await deps.registerExtraRoutes(app);
  }

  await registerWsBroadcaster(app, {
    getSnapshot: deps.getSnapshot,
    broadcastIntervalMs: deps.wsBroadcastIntervalMs,
  });

  const staticRoot = path.resolve(deps.staticRoot);

  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    wildcard: false,
    index: ['index.html'],
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).type('application/json').send({ error: 'Not Found' });
    }

    return reply.sendFile('index.html');
  });

  return app;
}
