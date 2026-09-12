import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppFooter } from './AppFooter';
import { ER_API_ATTRIBUTION_LABEL } from '../lib/fxAttribution';
import type { MarketSnapshot, Rate } from '../lib/types';

const NOW = 1_700_000_000_000;

function snap(source: string): MarketSnapshot {
  const usdKrw: Rate = { value: 1400, fetchedAt: NOW, source, ratesDate: '2026-08-16' };
  return {
    updatedAt: NOW,
    fx: { usdKrw },
    coins: { BTC: {}, ETH: {}, XRP: {}, SOL: {}, DOT: {}, DOGE: {} },
  };
}

afterEach(() => {
  cleanup();
});

describe('AppFooter', () => {
  it('renders the required Exchange Rate API wording when FX is er-api', () => {
    render(<AppFooter snapshot={snap('er-api')} />);
    const link = screen.getByRole('link', { name: ER_API_ATTRIBUTION_LABEL });
    expect(link.getAttribute('href')).toBe('https://www.exchangerate-api.com');
    expect(document.querySelector('footer')).not.toBeNull();
  });

  it('stays honest for Frankfurter without claiming Exchange Rate API rates', () => {
    render(<AppFooter snapshot={snap('frankfurter')} />);
    expect(screen.queryByRole('link', { name: ER_API_ATTRIBUTION_LABEL })).toBeNull();
    expect(screen.getByText(/Frankfurter/)).toBeTruthy();
  });

  it('always links to public exchange docs', () => {
    render(<AppFooter snapshot={null} />);
    expect(screen.getByRole('link', { name: 'Upbit docs' }).getAttribute('href')).toBe(
      'https://docs.upbit.com',
    );
    expect(screen.getByRole('link', { name: 'Binance docs' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bitbank docs' })).toBeTruthy();
  });
});
