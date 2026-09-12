import type { BinanceConnectorHealth } from '../connectors/binance.js';
import type { BitbankConnectorHealth } from '../connectors/bitbank.js';
import type { FxConnectorHealth } from '../connectors/fx.js';
import type { UpbitConnectorHealth } from '../connectors/upbit.js';
import { STALENESS_THRESHOLDS } from '../core/snapshot.js';

export type ConnectorFeedStatus = 'live' | 'stale' | 'down';

export interface ConnectorHealthEntry {
  status: ConnectorFeedStatus;
  lastTickAgeMs: number | null;
  reconnects: number;
  lastError: string | null;
}

export interface HealthSummary {
  ok: boolean;
  connectors: {
    upbit: ConnectorHealthEntry;
    binance: ConnectorHealthEntry;
    bitbank: ConnectorHealthEntry;
    fx: ConnectorHealthEntry;
  };
}

export interface AggregatorHealthSources {
  upbit: UpbitConnectorHealth;
  binance: BinanceConnectorHealth;
  bitbank: BitbankConnectorHealth;
  fx: FxConnectorHealth;
}

type WsConnectorHealth = UpbitConnectorHealth | BinanceConnectorHealth | BitbankConnectorHealth;

function mapWsConnectorHealth(
  health: WsConnectorHealth,
  now: number,
  thresholds: { staleAfterMs: number; downAfterMs: number },
): ConnectorHealthEntry {
  const lastTickAgeMs = health.lastTickAt !== null ? now - health.lastTickAt : null;
  const reconnects = health.reconnectAttempts;
  const lastError = health.lastError?.message ?? null;

  if (health.status !== 'connected') {
    return { status: 'down', lastTickAgeMs, reconnects, lastError };
  }

  if (lastTickAgeMs === null) {
    return { status: 'down', lastTickAgeMs, reconnects, lastError };
  }

  if (lastTickAgeMs > thresholds.downAfterMs) {
    return { status: 'down', lastTickAgeMs, reconnects, lastError };
  }

  if (lastTickAgeMs > thresholds.staleAfterMs) {
    return { status: 'stale', lastTickAgeMs, reconnects, lastError };
  }

  return { status: 'live', lastTickAgeMs, reconnects, lastError };
}

function mapFxConnectorHealth(health: FxConnectorHealth, now: number): ConnectorHealthEntry {
  const lastFetchAt = Math.max(
    health.lastSuccessfulFetchAt.erApi ?? 0,
    health.lastSuccessfulFetchAt.frankfurter ?? 0,
  );
  const lastTickAgeMs = lastFetchAt > 0 ? now - lastFetchAt : null;
  const reconnects = 0;
  let lastError = health.lastError?.message ?? null;
  if (health.timeEolDetected) {
    const eol = `er-api time_eol unix=${health.timeEolUnix ?? 'unknown'}`;
    lastError = lastError === null ? eol : `${lastError}; ${eol}`;
  }
  const { staleAfterMs, downAfterMs } = STALENESS_THRESHOLDS.fx;

  if (lastTickAgeMs === null) {
    return { status: 'down', lastTickAgeMs, reconnects, lastError };
  }

  if (lastTickAgeMs > downAfterMs) {
    return { status: 'down', lastTickAgeMs, reconnects, lastError };
  }

  if (lastTickAgeMs > staleAfterMs || health.status === 'stale') {
    return { status: 'stale', lastTickAgeMs, reconnects, lastError };
  }

  if (health.status === 'error') {
    return { status: 'down', lastTickAgeMs, reconnects, lastError };
  }

  return { status: 'live', lastTickAgeMs, reconnects, lastError };
}

/**
 * Aggregates per-connector internal health into the `/api/health` contract.
 * `ok` is true when no connector is `down`.
 */
export function aggregateHealth(sources: AggregatorHealthSources, now: number): HealthSummary {
  const connectors = {
    upbit: mapWsConnectorHealth(sources.upbit, now, STALENESS_THRESHOLDS.upbit),
    binance: mapWsConnectorHealth(sources.binance, now, STALENESS_THRESHOLDS.binance),
    bitbank: mapWsConnectorHealth(sources.bitbank, now, STALENESS_THRESHOLDS.bitbank),
    fx: mapFxConnectorHealth(sources.fx, now),
  };

  const ok = Object.values(connectors).every((entry) => entry.status !== 'down');

  return { ok, connectors };
}
