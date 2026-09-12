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

import { createBinanceBrowserClient } from './binanceBrowser';
import { createBitbankBrowserClient } from './bitbankBrowser';
import { loadFxRates } from './fxBrowser';
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
  loadFx?: typeof loadFxRates;
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
      connected.upbit = isConnected;
      setStatus();
    },
  });

  const binance = (options.createBinance ?? createBinanceBrowserClient)({
    onMessage: (raw) => {
      const normalized = normalizeBinanceWsMessage(raw);
      if (!normalized) {
        return;
      }
      snapshot = mergeTicker(snapshot, 'binance', normalized.coin, normalized.ticker, now());
    },
    onConnectionChange: (isConnected) => {
      connected.binance = isConnected;
      setStatus();
    },
  });

  const bitbank = (options.createBitbank ?? createBitbankBrowserClient)({
    onTickerMessage: (raw) => {
      const normalized = normalizeBitbankWsMessage(raw);
      if (normalized?.kind !== 'ticker') {
        return;
      }
      snapshot = mergeTicker(snapshot, 'bitbank', normalized.coin, normalized.ticker, now());
    },
    onCircuitBreak: () => {
      // Circuit-break rooms only; mid-price already omitted when the book is unusable.
    },
    onConnectionChange: (isConnected) => {
      connected.bitbank = isConnected;
      setStatus();
    },
  });

  return {
    start: () => {
      stopped = false;
      hasBeenLive = false;
      snapshot = createEmptySnapshot(now());
      options.onStatusChange('connecting');
      options.onSnapshot(snapshot);

      const loadFx = options.loadFx ?? loadFxRates;
      void loadFx().then((rates) => {
        if (stopped || !rates) {
          return;
        }
        snapshot = mergeFxRate(snapshot, 'usdKrw', rates.usdKrw, now());
        snapshot = mergeFxRate(snapshot, 'usdJpy', rates.usdJpy, now());
      });

      upbit.start();
      binance.start();
      bitbank.start();

      publishTimer = setInterval(publish, SNAPSHOT_PUBLISH_INTERVAL_MS);
    },
    stop: () => {
      stopped = true;
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
