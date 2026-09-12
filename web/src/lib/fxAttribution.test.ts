import { describe, expect, it } from 'vitest';

import { fxAttributionKind } from './fxAttribution';
import type { MarketSnapshot, Rate } from './types';

const NOW = 1_700_000_000_000;

function snap(source: string): MarketSnapshot {
  const usdKrw: Rate = { value: 1400, fetchedAt: NOW, source, ratesDate: '2026-08-16' };
  return {
    updatedAt: NOW,
    fx: { usdKrw },
    coins: { BTC: {}, ETH: {}, XRP: {}, SOL: {}, DOT: {}, DOGE: {} },
  };
}

describe('fxAttributionKind', () => {
  it('requires Exchange Rate API wording only when er-api rates are in the snapshot', () => {
    expect(fxAttributionKind(snap('er-api'))).toBe('er-api');
    expect(fxAttributionKind(snap('frankfurter'))).toBe('frankfurter');
    expect(fxAttributionKind(null)).toBe('unknown');
  });
});
