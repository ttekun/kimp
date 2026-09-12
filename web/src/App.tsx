import { useEffect } from 'react';

import { AppFooter } from './components/AppFooter';
import { FeaturedHero } from './components/FeaturedHero';
import { FxStatusBar } from './components/FxStatusBar';
import { PremiumTable } from './components/PremiumTable';
import { useMarketSocket } from './hooks/useMarketSocket';
import { useMarketStore } from './store/marketStore';
import './styles/App.css';

export function App() {
  useMarketSocket();
  const snapshot = useMarketStore((state) => state.snapshot);
  const connectionStatus = useMarketStore((state) => state.connectionStatus);

  useEffect(() => {
    const pending = window.__KIMP_E2E_PENDING_SNAPSHOT__;
    if (!pending) {
      return;
    }
    useMarketStore.getState().setSnapshot(pending);
    useMarketStore.getState().setConnectionStatus('live');
  }, []);

  return (
    <div className="app">
      <FxStatusBar snapshot={snapshot} connectionStatus={connectionStatus} />

      <main className="app__main">
        <FeaturedHero snapshot={snapshot} />

        <div className="premium-tables">
          <PremiumTable pair="binance" snapshot={snapshot} />
          <PremiumTable pair="bitbank" snapshot={snapshot} />
        </div>
      </main>

      <AppFooter snapshot={snapshot} />
    </div>
  );
}
