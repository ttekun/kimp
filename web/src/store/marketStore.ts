import { create } from 'zustand';

import type { MarketSnapshot } from '../lib/types';

/** Aggregator transport status exposed to the FX bar / reconnect banner (task 4.3). */
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'polling';

export interface MarketStoreState {
  snapshot: MarketSnapshot | null;
  connectionStatus: ConnectionStatus;
  setSnapshot: (snapshot: MarketSnapshot) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
}

export const useMarketStore = create<MarketStoreState>((set) => ({
  snapshot: null,
  connectionStatus: 'connecting',
  setSnapshot: (snapshot) => {
    set({ snapshot });
  },
  setConnectionStatus: (connectionStatus) => {
    set({ connectionStatus });
  },
}));
