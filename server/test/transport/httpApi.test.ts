import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createEmptySnapshot } from '../../src/core/snapshot.js';
import { buildHttpApi } from '../../src/transport/httpApi.js';
import type { HealthSummary } from '../../src/transport/health.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) =>
        import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true })),
      ),
  );
});

async function createStaticFixture(
  html = '<!doctype html><html><body>fixture</body></html>',
): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `kimchi-static-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), html, 'utf8');
  tempDirs.push(dir);
  return dir;
}

function sampleHealth(): HealthSummary {
  return {
    ok: true,
    connectors: {
      upbit: { status: 'live', lastTickAgeMs: 100, reconnects: 0, lastError: null },
      binance: { status: 'live', lastTickAgeMs: 200, reconnects: 0, lastError: null },
      bitbank: { status: 'stale', lastTickAgeMs: 35_000, reconnects: 1, lastError: null },
      fx: { status: 'live', lastTickAgeMs: 3_600_000, reconnects: 0, lastError: null },
    },
  };
}

describe('buildHttpApi', () => {
  it('GET /api/snapshot returns injected snapshot as JSON', async () => {
    const snapshot = createEmptySnapshot(1_700_000_000_000);
    const app = await buildHttpApi({
      getSnapshot: () => snapshot,
      getHealth: sampleHealth,
      staticRoot: await createStaticFixture(),
    });

    const response = await app.inject({ method: 'GET', url: '/api/snapshot' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(response.body)).toEqual(snapshot);

    await app.close();
  });

  it('GET /api/health returns injected health shape', async () => {
    const health = sampleHealth();
    const app = await buildHttpApi({
      getSnapshot: () => createEmptySnapshot(Date.now()),
      getHealth: () => health,
      staticRoot: await createStaticFixture(),
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(response.body)).toEqual(health);

    await app.close();
  });

  it('serves index.html for non-API paths', async () => {
    const html = '<!doctype html><html><body>kimchi-fixture</body></html>';
    const app = await buildHttpApi({
      getSnapshot: () => createEmptySnapshot(Date.now()),
      getHealth: sampleHealth,
      staticRoot: await createStaticFixture(html),
    });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.body).toContain('kimchi-fixture');

    await app.close();
  });

  it('does not let static serving shadow /api/* routes', async () => {
    const app = await buildHttpApi({
      getSnapshot: () => createEmptySnapshot(42),
      getHealth: sampleHealth,
      staticRoot: await createStaticFixture(),
    });

    const snapshotResponse = await app.inject({ method: 'GET', url: '/api/snapshot' });
    const healthResponse = await app.inject({ method: 'GET', url: '/api/health' });
    const missingApiResponse = await app.inject({ method: 'GET', url: '/api/unknown' });

    expect(snapshotResponse.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(snapshotResponse.body).updatedAt).toBe(42);

    expect(healthResponse.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(healthResponse.body).ok).toBe(true);

    expect(missingApiResponse.statusCode).toBe(404);
    expect(missingApiResponse.headers['content-type']).toMatch(/application\/json/);

    await app.close();
  });

  it('sets CSP and frame-guard headers on API and HTML responses', async () => {
    const app = await buildHttpApi({
      getSnapshot: () => createEmptySnapshot(Date.now()),
      getHealth: sampleHealth,
      staticRoot: await createStaticFixture(),
    });

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    const html = await app.inject({ method: 'GET', url: '/' });

    expect(health.headers['content-security-policy']).toContain("default-src 'self'");
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(html.headers['content-security-policy']).toContain("script-src 'self'");
    expect(html.headers['strict-transport-security']).toBeUndefined();

    await app.close();
  });

  it('does not expose a raw FX rates feed at /api/fx', async () => {
    const app = await buildHttpApi({
      getSnapshot: () => createEmptySnapshot(Date.now()),
      getHealth: sampleHealth,
      staticRoot: await createStaticFixture(),
    });

    const response = await app.inject({ method: 'GET', url: '/api/fx' });
    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
