import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MarketSnapshot } from '../lib/types';
import { useMarketStore } from '../store/marketStore';
import { useMarketSocket } from './useMarketSocket';

const BASE_TS = 1_700_000_000_000;

function makeSnapshot(updatedAt = BASE_TS): MarketSnapshot {
  return {
    updatedAt,
    fx: {},
    coins: {
      BTC: {},
      ETH: {},
      XRP: {},
      SOL: {},
      DOT: {},
      DOGE: {},
    },
  };
}

describe('useMarketSocket', () => {
  beforeEach(() => {
    window.__KIMP_E2E_DISABLE_LIVE__ = false;
    useMarketStore.setState({
      snapshot: null,
      connectionStatus: 'connecting',
    });
  });

  afterEach(() => {
    cleanup();
    window.__KIMP_E2E_DISABLE_LIVE__ = false;
    useMarketStore.setState({
      snapshot: null,
      connectionStatus: 'connecting',
    });
  });

  it('wires aggregator snapshots into the Zustand store', () => {
    renderHook(() =>
      useMarketSocket({
        createAggregator: (handlers) => ({
          start: () => {
            handlers.onStatusChange('live');
            handlers.onSnapshot(makeSnapshot());
          },
          stop: () => undefined,
        }),
      }),
    );

    expect(useMarketStore.getState().snapshot).toEqual(makeSnapshot());
    expect(useMarketStore.getState().connectionStatus).toBe('live');
  });

  it('stops the aggregator on unmount', () => {
    let stopped = false;
    const { unmount } = renderHook(() =>
      useMarketSocket({
        createAggregator: () => ({
          start: () => undefined,
          stop: () => {
            stopped = true;
          },
        }),
      }),
    );

    act(() => {
      unmount();
    });

    expect(stopped).toBe(true);
  });

  it('skips the live aggregator when E2E disable flag is set', () => {
    window.__KIMP_E2E_DISABLE_LIVE__ = true;
    let started = false;

    renderHook(() =>
      useMarketSocket({
        createAggregator: () => ({
          start: () => {
            started = true;
          },
          stop: () => undefined,
        }),
      }),
    );

    expect(started).toBe(false);
  });
});
