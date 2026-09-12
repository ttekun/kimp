import { describe, expect, it } from 'vitest';

import { createAggregatorSnapshotStore } from '../../src/aggregator/state.js';
import { aggregateHealth } from '../../src/transport/health.js';
import type { AggregatorHealthSources } from '../../src/transport/health.js';
import { STALENESS_THRESHOLDS } from '../../src/core/snapshot.js';

describe('aggregateHealth', () => {
  const now = 1_700_000_000_000;

  it('marks ok false when any connector is down', () => {
    const sources: AggregatorHealthSources = {
      upbit: {
        status: 'connected',
        reconnectAttempts: 0,
        lastTickAt: now - 1_000,
        lastError: null,
      },
      binance: {
        status: 'disconnected',
        reconnectAttempts: 2,
        lastTickAt: now - 5_000,
        lastError: { kind: 'ws_protocol', message: 'closed', at: now },
      },
      bitbank: {
        status: 'connected',
        reconnectAttempts: 0,
        lastTickAt: now - 2_000,
        lastError: null,
      },
      fx: {
        status: 'ok',
        lastError: null,
        lastSuccessfulFetchAt: { erApi: now - 60_000, frankfurter: null },
        lastDivergenceCheck: null,
        timeEolDetected: false,
        timeEolUnix: null,
        fetchCountToday: 1,
        totalFetches: 1,
      },
    };

    const health = aggregateHealth(sources, now);

    expect(health.ok).toBe(false);
    expect(health.connectors.upbit.status).toBe('live');
    expect(health.connectors.binance.status).toBe('down');
    expect(health.connectors.binance.reconnects).toBe(2);
    expect(health.connectors.binance.lastError).toBe('closed');
    expect(health.connectors.fx.status).toBe('live');
  });

  it('marks WS connector stale when tick age exceeds stale threshold', () => {
    const sources: AggregatorHealthSources = {
      upbit: {
        status: 'connected',
        reconnectAttempts: 0,
        lastTickAt: now - STALENESS_THRESHOLDS.upbit.staleAfterMs - 1,
        lastError: null,
      },
      binance: {
        status: 'connected',
        reconnectAttempts: 0,
        lastTickAt: now - 1_000,
        lastError: null,
      },
      bitbank: {
        status: 'connected',
        reconnectAttempts: 0,
        lastTickAt: now - 1_000,
        lastError: null,
      },
      fx: {
        status: 'ok',
        lastError: null,
        lastSuccessfulFetchAt: { erApi: now - 60_000, frankfurter: null },
        lastDivergenceCheck: null,
        timeEolDetected: false,
        timeEolUnix: null,
        fetchCountToday: 1,
        totalFetches: 1,
      },
    };

    const health = aggregateHealth(sources, now);

    expect(health.ok).toBe(true);
    expect(health.connectors.upbit.status).toBe('stale');
    expect(health.connectors.upbit.lastTickAgeMs).toBe(STALENESS_THRESHOLDS.upbit.staleAfterMs + 1);
  });

  it('surfaces er-api time_eol on the FX health lastError (runbook watchlist)', () => {
    const sources: AggregatorHealthSources = {
      upbit: {
        status: 'connected',
        reconnectAttempts: 0,
        lastTickAt: now - 1_000,
        lastError: null,
      },
      binance: {
        status: 'connected',
        reconnectAttempts: 0,
        lastTickAt: now - 1_000,
        lastError: null,
      },
      bitbank: {
        status: 'connected',
        reconnectAttempts: 0,
        lastTickAt: now - 1_000,
        lastError: null,
      },
      fx: {
        status: 'ok',
        lastError: null,
        lastSuccessfulFetchAt: { erApi: now - 60_000, frankfurter: null },
        lastDivergenceCheck: null,
        timeEolDetected: true,
        timeEolUnix: 1_900_000_000,
        fetchCountToday: 1,
        totalFetches: 1,
      },
    };

    const health = aggregateHealth(sources, now);
    expect(health.connectors.fx.lastError).toBe('er-api time_eol unix=1900000000');
    expect(health.ok).toBe(true);
  });
});

describe('createAggregatorSnapshotStore', () => {
  it('merges connector callbacks into an immutable snapshot', () => {
    const store = createAggregatorSnapshotStore(1_000);

    store.onUpbitTicker('BTC', {
      price: 100_000_000,
      change24hPct: 1.2,
      volume24hKrw: 1_000_000_000,
      ts: 900,
      status: 'live',
    });

    store.onFxRates({
      usdKrw: { value: 1400, fetchedAt: 800, source: 'er-api', ratesDate: '2026-08-17' },
      usdJpy: { value: 150, fetchedAt: 800, source: 'er-api', ratesDate: '2026-08-17' },
    });

    const snapshot = store.getSnapshot();

    expect(snapshot.coins.BTC.upbit?.price).toBe(100_000_000);
    expect(snapshot.fx.usdKrw?.value).toBe(1400);
    expect(snapshot.fx.usdJpy?.value).toBe(150);
    expect(snapshot.updatedAt).toBeGreaterThanOrEqual(1_000);
  });
});
