import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PremiumTable } from './PremiumTable';
import { FX_EM_DASH } from '../lib/formatFx';
import type { FeedStatus, MarketSnapshot, Premium, Rate, UpbitTicker } from '../lib/types';

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
        premiumBinance: premium(-0.5),
      },
      ETH: {
        upbit: upbit(4_000_000, 'stale'),
        binance: ticker(2_800, 'stale'),
        premiumBinance: premium(1.2, 'stale'),
      },
      XRP: {
        upbit: upbit(2_000),
        binance: ticker(1.4),
        premiumBinance: premium(2.0),
      },
      SOL: {
        upbit: upbit(150_000),
        binance: ticker(100),
        premiumBinance: premium(-1.1),
      },
      DOT: {
        upbit: upbit(1_200, 'down'),
        binance: ticker(0.9),
      },
      DOGE: {
        upbit: upbit(140),
        binance: ticker(0.1),
        premiumBinance: premium(0.1),
      },
    },
  };
}

afterEach(() => {
  cleanup();
});

describe('PremiumTable', () => {
  it('places Coin then Premium as the first two data columns', () => {
    render(<PremiumTable pair="binance" snapshot={snapshot()} />);
    const headers = [...document.querySelectorAll('thead th[data-col]')].map((cell) =>
      cell.getAttribute('data-col'),
    );
    expect(headers.slice(0, 2)).toEqual(['coin', 'premium']);

    const btcRow = screen.getByRole('rowheader', { name: 'BTC' }).closest('tr');
    expect(btcRow).toBeTruthy();
    const cells = [...btcRow!.querySelectorAll('[data-col]')].map((cell) =>
      cell.getAttribute('data-col'),
    );
    expect(cells.slice(0, 2)).toEqual(['coin', 'premium']);
  });

  it('renders an em dash for a down/missing DOT premium, not a frozen number', () => {
    render(<PremiumTable pair="binance" snapshot={snapshot()} />);
    const dotPremium = screen.getByLabelText('DOT premium');
    expect(dotPremium.textContent).toBe(FX_EM_DASH);
    expect(dotPremium.closest('tr')?.getAttribute('data-omit')).toBe('true');
  });

  it('defaults to Premium descending (live high-to-low, omitted last)', () => {
    render(<PremiumTable pair="binance" snapshot={snapshot()} />);
    expect(screen.getByRole('button', { name: /Premium/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /Premium/ }).textContent).toContain('↓');

    const body = document.querySelector('tbody');
    expect(body).toBeTruthy();
    const coins = within(body as HTMLElement)
      .getAllByRole('row')
      .filter((row) => row.querySelector('th[scope="row"]'))
      .map((row) => row.querySelector('th[scope="row"]')?.textContent);

    expect(coins).toEqual(['XRP', 'DOGE', 'BTC', 'SOL', 'ETH', 'DOT']);
  });

  it('toggles Premium to ascending when the header is clicked', () => {
    render(<PremiumTable pair="binance" snapshot={snapshot()} />);
    fireEvent.click(screen.getByRole('button', { name: /Premium/ }));

    const body = document.querySelector('tbody');
    expect(body).toBeTruthy();
    const coins = within(body as HTMLElement)
      .getAllByRole('row')
      .filter((row) => row.querySelector('th[scope="row"]'))
      .map((row) => row.querySelector('th[scope="row"]')?.textContent);

    expect(coins).toEqual(['SOL', 'BTC', 'DOGE', 'XRP', 'ETH', 'DOT']);
  });
});
