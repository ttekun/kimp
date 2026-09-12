import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FxStatusBar } from './FxStatusBar';
import { FX_DOWN_AFTER_MS, FX_STALE_AFTER_MS } from '../lib/feedStatus';
import { FX_EM_DASH } from '../lib/formatFx';
import type { FeedStatus, MarketSnapshot, Rate, UpbitTicker } from '../lib/types';

const NOW = 1_700_000_000_000;

function rate(overrides: Partial<Rate> = {}): Rate {
  return {
    value: 1414.86,
    fetchedAt: NOW,
    source: 'er-api',
    ratesDate: '2026-08-16',
    ...overrides,
  };
}

function ticker(status: FeedStatus): UpbitTicker {
  return { price: 1, ts: NOW, status, change24hPct: 0, volume24hKrw: 0 };
}

function liveCoins(dotBitbank: FeedStatus = 'live'): MarketSnapshot['coins'] {
  const live = ticker('live');
  return {
    BTC: { upbit: live, binance: live, bitbank: live },
    ETH: { upbit: live, binance: live, bitbank: live },
    XRP: { upbit: live, binance: live, bitbank: live },
    SOL: { upbit: live, binance: live, bitbank: live },
    DOT: { upbit: live, binance: live, bitbank: ticker(dotBitbank) },
    DOGE: { upbit: live, binance: live, bitbank: live },
  };
}

afterEach(() => {
  cleanup();
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
});

describe('FxStatusBar', () => {
  it('shows em dashes and down dots when FX and tickers are missing', () => {
    render(<FxStatusBar snapshot={null} connectionStatus="connecting" />);

    expect(screen.getByLabelText('FX rates').textContent).toContain(FX_EM_DASH);
    expect(screen.getByText('Upbit down')).toBeTruthy();
    expect(screen.getByText('FX down')).toBeTruthy();
    expect(screen.getByText('Connecting')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders rates, source badge, and live dots from a snapshot', () => {
    const snapshot: MarketSnapshot = {
      updatedAt: NOW,
      fx: {
        usdKrw: rate(),
        usdJpy: rate({ value: 159 }),
        krwPerJpy: 8.8851,
        usdtKrwImplied: rate({ value: 1414.8, source: 'upbit' }),
      },
      coins: liveCoins(),
    };

    render(<FxStatusBar snapshot={snapshot} connectionStatus="live" />);

    expect(screen.getByText('1,414.9')).toBeTruthy();
    expect(screen.getByText('8.8851')).toBeTruthy();
    expect(screen.getByText('1,414.8')).toBeTruthy();
    expect(screen.getByText('er-api 08-16')).toBeTruthy();
    expect(screen.getByText('Upbit live')).toBeTruthy();
    expect(screen.getByText('Binance live')).toBeTruthy();
    expect(screen.getByText('Bitbank live')).toBeTruthy();
    expect(screen.getByText('FX live')).toBeTruthy();
  });

  it('keeps Upbit/Binance live when only Bitbank DOT is down', () => {
    const snapshot: MarketSnapshot = {
      updatedAt: NOW,
      fx: { usdKrw: rate() },
      coins: liveCoins('down'),
    };

    render(<FxStatusBar snapshot={snapshot} connectionStatus="live" />);

    expect(screen.getByText('Upbit live')).toBeTruthy();
    expect(screen.getByText('Binance live')).toBeTruthy();
    expect(screen.getByText('Bitbank down')).toBeTruthy();
  });

  it('marks FX stale from fetchedAt vs updatedAt using the 26h threshold', () => {
    const snapshot: MarketSnapshot = {
      updatedAt: NOW,
      fx: { usdKrw: rate({ fetchedAt: NOW - FX_STALE_AFTER_MS - 1 }) },
      coins: liveCoins(),
    };

    render(<FxStatusBar snapshot={snapshot} connectionStatus="live" />);
    expect(screen.getByText('FX stale')).toBeTruthy();
  });

  it('omits daily FX numbers when the feed is down (em dash, never a frozen current figure)', () => {
    const snapshot: MarketSnapshot = {
      updatedAt: NOW,
      fx: { usdKrw: rate({ fetchedAt: NOW - FX_DOWN_AFTER_MS - 1 }), krwPerJpy: 8.8851 },
      coins: liveCoins(),
    };

    render(<FxStatusBar snapshot={snapshot} connectionStatus="live" />);
    expect(screen.getByText('FX down')).toBeTruthy();
    expect(screen.queryByText('1,414.9')).toBeNull();
    expect(screen.queryByText('8.8851')).toBeNull();
    expect(screen.getByLabelText('FX rates').textContent).toContain(FX_EM_DASH);
  });

  it('shows reconnecting and polling banners from transport state', () => {
    const { rerender } = render(<FxStatusBar snapshot={null} connectionStatus="reconnecting" />);
    expect(screen.getByRole('status').textContent).toMatch(/Reconnecting/);

    rerender(<FxStatusBar snapshot={null} connectionStatus="polling" />);
    expect(screen.getByRole('status').textContent).toMatch(/polling/i);
  });
});
