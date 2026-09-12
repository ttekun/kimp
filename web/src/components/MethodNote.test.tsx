import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MethodNote } from './MethodNote';
import type { MarketSnapshot, Rate } from '../lib/types';

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);

function snapshot(): MarketSnapshot {
  const usdKrw: Rate = {
    value: 1414.86,
    fetchedAt: NOW,
    source: 'er-api',
    ratesDate: '2026-08-16',
  };
  return {
    updatedAt: NOW,
    fx: { usdKrw, usdJpy: { ...usdKrw, value: 159.23 } },
    coins: { BTC: {}, ETH: {}, XRP: {}, SOL: {}, DOT: {}, DOGE: {} },
  };
}

afterEach(() => {
  cleanup();
});

describe('MethodNote', () => {
  it('exposes Pair A/B formulas, FX source timestamp, and the USDT caveat when opened', () => {
    render(<MethodNote snapshot={snapshot()} />);
    fireEvent.click(screen.getByText('Method / source note'));
    expect(screen.getByText(/Pair A \(Upbit vs Binance\)/)).toBeTruthy();
    expect(screen.getByText(/Pair B \(Upbit vs Bitbank\)/)).toBeTruthy();
    expect(screen.getByTestId('fx-source').textContent).toBe('er-api');
    expect(screen.getAllByText(/2026-08-16/).length).toBeGreaterThan(0);
    expect(screen.getByText(/USDT is not USD/)).toBeTruthy();
  });
});
