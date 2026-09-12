import { useEffect } from 'react';

import {
  createClientAggregator,
  type ClientAggregator,
  type ClientAggregatorOptions,
} from '../lib/clientAggregator';
import { useMarketStore } from '../store/marketStore';

export interface UseMarketSocketOptions {
  createAggregator?: (options: ClientAggregatorOptions) => ClientAggregator;
}

export function useMarketSocket(options: UseMarketSocketOptions = {}): void {
  const setSnapshot = useMarketStore((state) => state.setSnapshot);
  const setConnectionStatus = useMarketStore((state) => state.setConnectionStatus);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__KIMP_E2E_DISABLE_LIVE__) {
      return;
    }

    const factory = options.createAggregator ?? createClientAggregator;
    const connection = factory({
      onSnapshot: setSnapshot,
      onStatusChange: setConnectionStatus,
    });
    connection.start();

    return () => {
      connection.stop();
    };
  }, [options.createAggregator, setConnectionStatus, setSnapshot]);
}
