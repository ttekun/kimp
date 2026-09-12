import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FeaturedHero } from './FeaturedHero';
import { FX_EM_DASH } from '../lib/formatFx';
import type { FeedStatus, MarketSnapshot, Premium, Rate, UpbitTicker } from '../lib/types';

const NOW = 1_700_000_000_000;

function rate(value = 1400): Rate {
  return { value, fetchedAt: NOW, source: 'er-api', ratesDate: '2026-08-16' };
}

function upbit(price: number, status: FeedStatus = 'live'): UpbitTicker {
  return { price, ts: NOW, status, change24hPct: 1, volume24hKrw: 1e11 };
}

function ticker(price: number, status: FeedStatus = 'live', ts = NOW) {
  return { price, ts, status };
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
        premiumBitbank: premium(-0.26, 'down'),
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
});

describe('FeaturedHero', () => {
  it('defaults to BTC live premium and never shows the placeholder -0.26%', () => {
    render(<FeaturedHero snapshot={snapshot()} />);
    expect(screen.getByRole('radio', { name: 'BTC' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('BTC Binance premium').textContent).toContain('-0.50%');
    expect(screen.queryByText('-0.26%')).toBeNull();
  });

  it('switches the hero to ETH without using a frozen placeholder', () => {
    render(<FeaturedHero snapshot={snapshot()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'ETH' }));
    expect(screen.getByRole('radio', { name: 'ETH' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('ETH Binance premium').textContent).toContain('+1.20%');
    expect(screen.getByLabelText('ETH Bitbank premium').textContent).toContain('+0.80%');
  });

  it('omits DOT premium as an em dash instead of the leftover -0.26%', () => {
    render(<FeaturedHero snapshot={snapshot()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'DOT' }));
    const premium = screen.getByLabelText('DOT Binance premium');
    expect(premium.textContent).toBe(FX_EM_DASH);
    expect(premium.textContent).not.toContain('-0.26');
    expect(screen.getByLabelText('DOT Bitbank premium').textContent).toContain(FX_EM_DASH);
  });

  it('moves the radiogroup selection with arrow keys', () => {
    render(<FeaturedHero snapshot={snapshot()} />);
    const group = screen.getByRole('radiogroup', { name: 'Featured coin' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'ETH' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(group, { key: 'End' });
    expect(screen.getByRole('radio', { name: 'DOGE' }).getAttribute('aria-checked')).toBe('true');
    expect(within(group).getAllByRole('radio')).toHaveLength(6);
  });
});
