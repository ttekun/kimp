import type { BinanceConnector } from '../connectors/binance.js';
import type { BitbankConnector } from '../connectors/bitbank.js';
import type { FxPoller } from '../connectors/fx.js';
import type { UpbitConnector } from '../connectors/upbit.js';
import {
  createEmptySnapshot,
  mergeFxRate,
  mergeTicker,
  recomputeSnapshot,
} from '../core/snapshot.js';
import type { CoinSymbol } from '../core/symbols.js';
import type { Rate, Ticker } from '../core/types.js';
import { aggregateHealth, type AggregatorHealthSources } from '../transport/health.js';

export interface AggregatorConnectors {
  upbit: UpbitConnector;
  binance: BinanceConnector;
  bitbank: BitbankConnector;
  fx: FxPoller;
}

export interface AggregatorSnapshotStore {
  getSnapshot: () => ReturnType<typeof recomputeSnapshot>;
  onUpbitTicker: (coin: CoinSymbol, ticker: Ticker) => void;
  onUpbitUsdtRate: (rate: Rate) => void;
  onBinanceTicker: (coin: CoinSymbol, ticker: Ticker) => void;
  onBitbankTicker: (coin: CoinSymbol, ticker: Ticker) => void;
  onFxRates: (rates: { usdKrw: Rate; usdJpy: Rate }, options?: { acceptOlder?: boolean }) => void;
}

/** Maintains a single in-memory immutable snapshot updated by connector callbacks. */
export function createAggregatorSnapshotStore(now = Date.now()): AggregatorSnapshotStore {
  let snapshot = createEmptySnapshot(now);

  return {
    getSnapshot: () => recomputeSnapshot(snapshot, Date.now()),
    onUpbitTicker: (coin, ticker) => {
      snapshot = mergeTicker(snapshot, 'upbit', coin, ticker, Date.now());
    },
    onUpbitUsdtRate: (rate) => {
      snapshot = mergeFxRate(snapshot, 'usdtKrwImplied', rate, Date.now());
    },
    onBinanceTicker: (coin, ticker) => {
      snapshot = mergeTicker(snapshot, 'binance', coin, ticker, Date.now());
    },
    onBitbankTicker: (coin, ticker) => {
      snapshot = mergeTicker(snapshot, 'bitbank', coin, ticker, Date.now());
    },
    onFxRates: (rates, options) => {
      const ts = Date.now();
      snapshot = mergeFxRate(snapshot, 'usdKrw', rates.usdKrw, ts, options);
      snapshot = mergeFxRate(snapshot, 'usdJpy', rates.usdJpy, ts, options);
    },
  };
}

export function getAggregatorHealth(connectors: AggregatorConnectors, now = Date.now()) {
  const sources: AggregatorHealthSources = {
    upbit: connectors.upbit.getHealth(),
    binance: connectors.binance.getHealth(),
    bitbank: connectors.bitbank.getHealth(),
    fx: connectors.fx.getHealth(),
  };
  return aggregateHealth(sources, now);
}
