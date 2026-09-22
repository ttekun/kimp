import { describe, expect, it, vi } from 'vitest';

import { SNAPSHOT_PUBLISH_INTERVAL_MS, createClientAggregator } from './clientAggregator';
import type { MarketSnapshot } from './types';

describe('createClientAggregator', () => {
  it('publishes at 1 Hz and maps all-down to reconnecting after live', () => {
    vi.useFakeTimers();
    const snapshots: MarketSnapshot[] = [];
    const statuses: string[] = [];
    let upbitConnected: (connected: boolean) => void = () => undefined;
    let binanceConnected: (connected: boolean) => void = () => undefined;
    let bitbankConnected: (connected: boolean) => void = () => undefined;

    const aggregator = createClientAggregator({
      now: () => 1_000,
      createFx: () => ({ start: () => undefined, stop: () => undefined }),
      createUpbit: (callbacks) => {
        upbitConnected = callbacks.onConnectionChange;
        return { start: () => undefined, stop: () => undefined };
      },
      createBinance: (callbacks) => {
        binanceConnected = callbacks.onConnectionChange;
        return { start: () => undefined, stop: () => undefined };
      },
      createBitbank: (callbacks) => {
        bitbankConnected = callbacks.onConnectionChange;
        return { start: () => undefined, stop: () => undefined };
      },
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      onStatusChange: (status) => {
        statuses.push(status);
      },
    });

    aggregator.start();
    expect(statuses[0]).toBe('connecting');
    expect(snapshots[0]?.coins.BTC).toEqual({});

    upbitConnected(true);
    expect(statuses.at(-1)).toBe('live');

    upbitConnected(false);
    binanceConnected(false);
    bitbankConnected(false);
    expect(statuses.at(-1)).toBe('reconnecting');

    const before = snapshots.length;
    vi.advanceTimersByTime(SNAPSHOT_PUBLISH_INTERVAL_MS);
    expect(snapshots.length).toBeGreaterThan(before);

    aggregator.stop();
    vi.useRealTimers();
  });
});
