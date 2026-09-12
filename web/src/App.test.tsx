import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import type { FeedStatus, MarketSnapshot, Premium, Rate, UpbitTicker } from './lib/types';
import { useMarketStore } from './store/marketStore';

vi.mock('./hooks/useMarketSocket', () => ({
  useMarketSocket: () => undefined,
}));

const NOW = 1_700_000_000_000;

function rate(value = 1400): Rate {
  return { value, fetchedAt: NOW, source: 'er-api', ratesDate: '2026-08-16' };
}

function upbit(price: number, status: FeedStatus = 'live'): UpbitTicker {
  return { price, ts: NOW, status, change24hPct: 1, volume24hKrw: 1e11 };
}

function ticker(price: number, status: FeedStatus = 'live') {
  return { price, ts: NOW, status };
}

function premium(pct: number, status: FeedStatus = 'live'): Premium {
  return {
    pct,
    diffKrw: pct * 1000,
    computedAt: NOW,
    inputTs: { upbit: NOW, target: NOW, fx: NOW },
    status,
  };
}

function snapshot(): MarketSnapshot {
  return {
    updatedAt: NOW,
    fx: { usdKrw: rate(1400), usdJpy: rate(150), krwPerJpy: 1400 / 150 },
    coins: {
      BTC: {
        upbit: upbit(100_000_000),
        binance: ticker(70_000),
        bitbank: ticker(10_000_000),
        premiumBinance: premium(-0.5),
        premiumBitbank: premium(0.2),
      },
      ETH: {
        upbit: upbit(4_000_000),
        binance: ticker(2_800),
        bitbank: ticker(400_000),
        premiumBinance: premium(1.2),
        premiumBitbank: premium(0.8),
      },
      XRP: {
        upbit: upbit(2_000),
        binance: ticker(1.4),
        bitbank: ticker(200),
        premiumBinance: premium(2.0),
        premiumBitbank: premium(1.5),
      },
      SOL: {
        upbit: upbit(150_000),
        binance: ticker(100),
        bitbank: ticker(15_000),
        premiumBinance: premium(-1.1),
        premiumBitbank: premium(-0.3),
      },
      DOT: {
        upbit: upbit(1_200, 'down'),
        binance: ticker(0.9),
        bitbank: ticker(140),
        premiumBinance: premium(-0.26, 'down'),
      },
      DOGE: {
        upbit: upbit(140),
        binance: ticker(0.1),
        bitbank: ticker(15),
        premiumBinance: premium(0.1),
        premiumBitbank: premium(0.05),
      },
    },
  };
}

afterEach(() => {
  cleanup();
  useMarketStore.setState({ snapshot: null, connectionStatus: 'connecting' });
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
  useMarketStore.setState({ snapshot: snapshot(), connectionStatus: 'live' });
});

describe('App featured hero', () => {
  it('does not render the raw snapshot debug panel', () => {
    render(<App />);
    expect(screen.queryByLabelText('Market data debug')).toBeNull();
    expect(screen.queryByText(/Connection:/)).toBeNull();
    expect(screen.queryByText(/updatedAt:/)).toBeNull();
  });

  it('does not render the method / source note', () => {
    render(<App />);
    expect(screen.queryByText('Method / source note')).toBeNull();
    expect(screen.queryByLabelText('Method and sources')).toBeNull();
  });

  it('updates the hero on coin switch while both tables keep all coins', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: 'ETH' }));
    expect(screen.getByLabelText('ETH Binance premium').textContent).toContain('+1.20%');

    const binanceTable = document.querySelector('[data-pair="binance"] tbody');
    expect(binanceTable).toBeTruthy();
    const coins = within(binanceTable as HTMLElement)
      .getAllByRole('row')
      .filter((row) => row.querySelector('th[scope="row"]'))
      .map((row) => row.querySelector('th[scope="row"]')?.textContent);
    expect(coins).toHaveLength(6);
    expect(coins.sort()).toEqual(['BTC', 'DOGE', 'DOT', 'ETH', 'SOL', 'XRP']);
  });
});
