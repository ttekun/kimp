import type { FastifyInstance } from 'fastify';

import type { AggregatorConnectors, AggregatorSnapshotStore } from '../aggregator/state.js';
import { STALENESS_THRESHOLDS } from '../core/snapshot.js';
import { COIN_SYMBOLS, type CoinSymbol } from '../core/symbols.js';
import type { BinanceTicker, BitbankTicker, Rate, UpbitTicker } from '../core/types.js';

export type FaultFeed = 'upbit' | 'binance' | 'bitbank' | 'fx';

export type FaultAction =
  | { action: 'kill'; feed: FaultFeed }
  | { action: 'restart'; feed: FaultFeed }
  | { action: 'age-fx'; ageMs: number }
  | { action: 'skew'; coin: CoinSymbol }
  | { action: 'malformed'; feed: 'upbit' };

export interface FaultInjectionDeps {
  connectors: AggregatorConnectors;
  store: AggregatorSnapshotStore;
}

function isCoinSymbol(value: unknown): value is CoinSymbol {
  return typeof value === 'string' && (COIN_SYMBOLS as readonly string[]).includes(value);
}

function isFaultFeed(value: unknown): value is FaultFeed {
  return value === 'upbit' || value === 'binance' || value === 'bitbank' || value === 'fx';
}

function parseFaultAction(body: unknown): FaultAction | { error: string } {
  if (typeof body !== 'object' || body === null) {
    return { error: 'JSON object required' };
  }

  const record = body as Record<string, unknown>;
  const action = record.action;

  if (action === 'kill' || action === 'restart') {
    if (!isFaultFeed(record.feed)) {
      return { error: 'feed must be upbit|binance|bitbank|fx' };
    }
    return { action, feed: record.feed };
  }

  if (action === 'age-fx') {
    const ageMs = record.ageMs;
    if (typeof ageMs !== 'number' || !Number.isFinite(ageMs) || ageMs < 0) {
      return { error: 'ageMs must be a non-negative finite number' };
    }
    return { action, ageMs };
  }

  if (action === 'skew') {
    const coin = record.coin ?? 'BTC';
    if (!isCoinSymbol(coin)) {
      return { error: 'coin must be BTC|ETH|XRP|SOL|DOT' };
    }
    return { action, coin };
  }

  if (action === 'malformed') {
    if (record.feed !== 'upbit') {
      return { error: 'malformed is only implemented for feed=upbit' };
    }
    return { action: 'malformed', feed: 'upbit' };
  }

  return { error: 'unknown action' };
}

async function restartFeed(connectors: AggregatorConnectors, feed: FaultFeed): Promise<void> {
  switch (feed) {
    case 'upbit':
      connectors.upbit.stop();
      await connectors.upbit.start();
      return;
    case 'binance':
      connectors.binance.stop();
      await connectors.binance.start();
      return;
    case 'bitbank':
      connectors.bitbank.stop();
      await connectors.bitbank.start();
      return;
    case 'fx':
      connectors.fx.stop();
      await connectors.fx.start();
  }
}

function killFeed(connectors: AggregatorConnectors, feed: FaultFeed): void {
  switch (feed) {
    case 'upbit':
      connectors.upbit.stop();
      return;
    case 'binance':
      connectors.binance.stop();
      return;
    case 'bitbank':
      connectors.bitbank.stop();
      return;
    case 'fx':
      connectors.fx.stop();
  }
}

/**
 * Ages FX `fetchedAt`/`observedAt` without waiting 26h. Stops the poller so a later
 * scheduled fetch cannot overwrite the injected age. Staleness is judged from
 * `observedAt` (see snapshot.ts `deriveFxStatus`), so both must be backdated together —
 * aging only `fetchedAt` would be a no-op against a real rate that carries `observedAt`.
 */
export function applyAgedFx(
  store: AggregatorSnapshotStore,
  connectors: AggregatorConnectors,
  ageMs: number,
): void {
  connectors.fx.stop();
  const snapshot = store.getSnapshot();
  const now = Date.now();
  const fetchedAt = now - ageMs;
  const usdKrw: Rate | undefined = snapshot.fx.usdKrw
    ? { ...snapshot.fx.usdKrw, fetchedAt, observedAt: fetchedAt }
    : undefined;
  const usdJpy: Rate | undefined = snapshot.fx.usdJpy
    ? { ...snapshot.fx.usdJpy, fetchedAt, observedAt: fetchedAt }
    : undefined;
  if (!usdKrw || !usdJpy) {
    throw new Error('Cannot age FX: usdKrw/usdJpy missing from snapshot');
  }
  // This dev-only fault intentionally backdates values to exercise staleness handling.
  store.onFxRates({ usdKrw, usdJpy }, { acceptOlder: true });
}

/**
 * Injects a future target timestamp so both legs stay age-live while |Δts| > 30s.
 */
export function applyClockSkew(store: AggregatorSnapshotStore, coin: CoinSymbol): void {
  const snapshot = store.getSnapshot();
  const coinSnap = snapshot.coins[coin];
  const now = Date.now();
  const skewOffset = STALENESS_THRESHOLDS.crossExchangeSkew.maxSkewMs + 1;
  const upbit = coinSnap.upbit;
  const binance = coinSnap.binance;
  const bitbank = coinSnap.bitbank;

  if (upbit) {
    const next: UpbitTicker = { ...upbit, ts: now };
    store.onUpbitTicker(coin, next);
  }
  if (binance) {
    const next: BinanceTicker = { ...binance, ts: now + skewOffset };
    store.onBinanceTicker(coin, next);
  }
  if (bitbank) {
    const next: BitbankTicker = { ...bitbank, ts: now + skewOffset };
    store.onBitbankTicker(coin, next);
  }
}

export async function applyFaultAction(
  deps: FaultInjectionDeps,
  action: FaultAction,
): Promise<{ ok: true; action: FaultAction }> {
  switch (action.action) {
    case 'kill':
      killFeed(deps.connectors, action.feed);
      return { ok: true, action };
    case 'restart':
      await restartFeed(deps.connectors, action.feed);
      return { ok: true, action };
    case 'age-fx':
      applyAgedFx(deps.store, deps.connectors, action.ageMs);
      return { ok: true, action };
    case 'skew':
      applyClockSkew(deps.store, action.coin);
      return { ok: true, action };
    case 'malformed':
      deps.connectors.upbit.ingestRawMessage(Buffer.from('not-json{{{'));
      return { ok: true, action };
  }
}

/** Dev-only routes. Caller must gate on FAULT_INJECTION=1. */
export function registerFaultInjectionRoutes(app: FastifyInstance, deps: FaultInjectionDeps): void {
  app.post('/api/dev/fault', async (request, reply) => {
    const parsed = parseFaultAction(request.body);
    if ('error' in parsed) {
      return reply.code(400).type('application/json').send({ error: parsed.error });
    }

    try {
      const result = await applyFaultAction(deps, parsed);
      return reply.type('application/json').send(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(409).type('application/json').send({ error: message });
    }
  });
}
