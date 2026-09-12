/// <reference types="vite/client" />

import type { MarketSnapshot } from './lib/types';
import type { ConnectionStatus } from './store/marketStore';

declare global {
  interface Window {
    __KIMP_E2E_DISABLE_LIVE__?: boolean;
    __KIMP_E2E_PENDING_SNAPSHOT__?: MarketSnapshot;
    __KIMP_E2E__?: {
      setSnapshot: (snapshot: MarketSnapshot) => void;
      setConnectionStatus: (status: ConnectionStatus) => void;
    };
  }
}

export {};
