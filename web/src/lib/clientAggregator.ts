import {
  createEmptySnapshot,
  mergeFxRate,
  mergeTicker,
  recomputeSnapshot,
} from '@kimchi/core/snapshot';
import { normalizeBinanceWsMessage } from '@kimchi/binance-wire';
import { normalizeBitbankWsMessage } from '@kimchi/bitbank-wire';
import { normalizeUpbitWireTicker } from '@kimchi/upbit-wire';
import type { MarketSnapshot } from '@kimchi/server-types';
import type { CoinSymbol } from './types';

import { createBinanceBrowserClient } from './binanceBrowser';
import { createBitbankBrowserClient } from './bitbankBrowser';
import { createFxBrowserClient } from './fxBrowser';
import { createUpbitBrowserClient } from './upbitBrowser';
import type { ConnectionStatus } from '../store/marketStore';

export const SNAPSHOT_PUBLISH_INTERVAL_MS = 1_000;

export interface ClientAggregator {
  start: () => void;
  stop: () => void;
}

export interface ClientAggregatorHandlers {
  onSnapshot: (snapshot: MarketSnapshot) => void;
  onStatusChange: (status: ConnectionStatus) => void;
}

export interface ClientAggregatorOptions extends ClientAggregatorHandlers {
  now?: () => number;
  createFx?: typeof createFxBrowserClient;
  createUpbit?: typeof createUpbitBrowserClient;
  createBinance?: typeof createBinanceBrowserClient;
  createBitbank?: typeof createBitbankBrowserClient;
}

export function createClientAggregator(options: ClientAggregatorOptions): ClientAggregator {
  const now = options.now ?? Date.now;
  let snapshot = createEmptySnapshot(now());
  let publishTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = true;
  let hasBeenLive = false;
  const circuitBreaks = new Map<CoinSymbol, { active: boolean; ts: number }>();

  const fx = (options.createFx ?? createFxBrowserClient)(
    {
      onRates: (rates) => {
        if (stopped) return;
        snapshot = mergeFxRate(snapshot, 'usdKrw', rates.usdKrw, now());
        snapshot = mergeFxRate(snapshot, 'usdJpy', rates.usdJpy, now());
      },
    },
    { now },
  );

  const connected = { upbit: false, binance: false, bitbank: false };

  const setStatus = (): void => {
    const anyUp = connected.upbit || connected.binance || connected.bitbank;
    if (anyUp) {
      hasBeenLive = true;
      options.onStatusChange('live');
      return;
    }
    if (hasBeenLive) {
      options.onStatusChange('reconnecting');
      return;
    }
    options.onStatusChange('connecting');
  };

  const publish = (): void => {
    snapshot = recomputeSnapshot(snapshot, now());
    options.onSnapshot(snapshot);
  };

  const upbit = (options.createUpbit ?? createUpbitBrowserClient)({
    onMessage: (raw) => {
      if (stopped) return;
      const normalized = normalizeUpbitWireTicker(raw);
      if (!normalized) {
        return;
      }
      if (normalized.kind === 'coin_ticker') {
        snapshot = mergeTicker(snapshot, 'upbit', normalized.coin, normalized.ticker, now());
      } else {
        snapshot = mergeFxRate(snapshot, 'usdtKrwImplied', normalized.rate, now());
      }
    },
    onConnectionChange: (isConnected) => {
      if (stopped) return;
      connected.upbit = isConnected;
      setStatus();
    },
  });

  const binance = (options.createBinance ?? createBinanceBrowserClient)({
    onMessage: (raw) => {
      if (stopped) return;
      const normalized = normalizeBinanceWsMessage(raw);
      if (!normalized) {
        return;
      }
      snapshot = mergeTicker(snapshot, 'binance', normalized.coin, normalized.ticker, now());
    },
    onConnectionChange: (isConnected) => {
      if (stopped) return;
      connected.binance = isConnected;
      setStatus();
    },
  });

  const bitbank = (options.createBitbank ?? createBitbankBrowserClient)({
    onTickerMessage: (raw) => {
      if (stopped) return;
      const normalized = normalizeBitbankWsMessage(raw);
      if (!normalized) {
        return;
      }
      if (normalized.kind === 'book_unusable') {
        snapshot = mergeTicker(
          snapshot,
          'bitbank',
          normalized.coin,
          { price: 0, ts: normalized.ts, status: 'down', unavailable: true },
          now(),
        );
      } else if (
        !circuitBreaks.get(normalized.coin)?.active &&
        normalized.ticker.ts >= (circuitBreaks.get(normalized.coin)?.ts ?? 0)
      ) {
        snapshot = mergeTicker(snapshot, 'bitbank', normalized.coin, normalized.ticker, now());
      }
    },
    onCircuitBreak: (coin, active, ts) => {
      if (stopped || ts < (circuitBreaks.get(coin)?.ts ?? -1)) return;
      circuitBreaks.set(coin, { active, ts });
      if (active) {
        const currentTs = snapshot.coins[coin].bitbank?.ts ?? ts;
        snapshot = mergeTicker(
          snapshot,
          'bitbank',
          coin,
          { price: 0, ts: Math.max(ts, currentTs), status: 'down', unavailable: true },
          now(),
        );
      }
    },
    onConnectionChange: (isConnected) => {
      if (stopped) return;
      connected.bitbank = isConnected;
      setStatus();
    },
  });

  return {
    start: () => {
      if (!stopped) return;
      stopped = false;
      connected.upbit = connected.binance = connected.bitbank = false;
      circuitBreaks.clear();
      hasBeenLive = false;
      snapshot = createEmptySnapshot(now());
      options.onStatusChange('connecting');
      options.onSnapshot(snapshot);

      fx.start();
      upbit.start();
      binance.start();
      bitbank.start();

      publishTimer = setInterval(publish, SNAPSHOT_PUBLISH_INTERVAL_MS);
    },
    stop: () => {
      stopped = true;
      fx.stop();
      if (publishTimer !== null) {
        clearInterval(publishTimer);
        publishTimer = null;
      }
      upbit.stop();
      binance.stop();
      bitbank.stop();
    },
  };
}
