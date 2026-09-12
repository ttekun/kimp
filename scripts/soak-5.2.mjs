#!/usr/bin/env node
/**
 * Task 5.2 soak sampler. Read-only GET /api/health + /api/snapshot.
 * Does not call FX providers.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = join(ROOT, 'logs', 'soak-5.2.jsonl');
const BASE = process.env.SOAK_BASE_URL ?? 'http://127.0.0.1:3000';
const PID = Number(process.env.SOAK_PID ?? '16892');
const T0_MS = Date.parse(process.env.SOAK_T0 ?? '2026-09-05T07:14:45.523Z');
const INTERVAL_MS = Number(process.env.SOAK_INTERVAL_MS ?? String(15 * 60 * 1000));
const TWELVE_H = 12 * 60 * 60 * 1000;
const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;

mkdirSync(join(ROOT, 'logs'), { recursive: true });

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}`);
  }
  return response.json();
}

function processAlive(pid) {
  try {
    execFileSync('kill', ['-0', String(pid)], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function rssKb(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

function coinStatus(snap, symbol) {
  if (!snap) {
    return null;
  }
  const coin = snap.coins[symbol];
  return {
    upbit: coin.upbit?.status ?? null,
    binance: coin.binance?.status ?? null,
    bitbank: coin.bitbank?.status ?? null,
    premA: coin.premiumBinance?.status ?? null,
    premB: coin.premiumBitbank?.status ?? null,
  };
}

async function sample(label) {
  const alive = processAlive(PID);
  const health = alive ? await getJson('/api/health') : null;
  const snap = alive ? await getJson('/api/snapshot') : null;

  const row = {
    label,
    sampledAt: new Date().toISOString(),
    pid: PID,
    alive,
    rssKb: rssKb(PID),
    elapsedSinceT0Ms: Date.now() - T0_MS,
    health,
    fxFetchedAt: snap?.fx?.usdKrw?.fetchedAt ?? null,
    fxSource: snap?.fx?.usdKrw?.source ?? null,
    BTC: coinStatus(snap, 'BTC'),
    ETH: coinStatus(snap, 'ETH'),
    SOL: coinStatus(snap, 'SOL'),
    DOT: coinStatus(snap, 'DOT'),
  };

  appendFileSync(LOG_FILE, `${JSON.stringify(row)}\n`);
  console.log(`[soak] ${label} rssKb=${row.rssKb} alive=${alive} health.ok=${health?.ok}`);
}

const fired = { twelve: false, twentyFour: false };

async function tick() {
  const elapsed = Date.now() - T0_MS;
  if (!fired.twelve && elapsed >= TWELVE_H) {
    fired.twelve = true;
    await sample('t12h');
  }
  if (!fired.twentyFour && elapsed >= TWENTY_FOUR_H) {
    fired.twentyFour = true;
    await sample('t24h');
    console.log('[soak] 24h complete; sampler exiting');
    process.exit(0);
  }
  await sample(`interval+${Math.round(elapsed / 60000)}m`);
}

console.log(`[soak] sampler pid=${process.pid} target=${PID} t0=${new Date(T0_MS).toISOString()}`);
await tick();
setInterval(() => {
  void tick().catch((error) => {
    console.error('[soak] sample failed', error);
  });
}, INTERVAL_MS);
