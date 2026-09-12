import { describe, expect, it } from 'vitest';

import { FX_EM_DASH } from './formatFx';
import {
  formatJpy,
  formatKrw,
  formatSignedPct,
  formatUsd,
  formatVolume100MKrw,
} from './formatMoney';

describe('formatMoney', () => {
  it('formats KRW without a fraction and USD/JPY with up to 2 digits', () => {
    expect(formatKrw(89_237_000)).toBe('89,237,000');
    expect(formatKrw(-234_689, true)).toBe('-234,689');
    expect(formatUsd(63074.4)).toBe('63,074.4');
    expect(formatJpy(12_454_607.5)).toBe('12,454,607.5');
  });

  it('formats signed percent with two fraction digits', () => {
    expect(formatSignedPct(-0.26)).toBe('-0.26');
    expect(formatSignedPct(1.417)).toBe('+1.42');
    expect(formatSignedPct(0)).toBe('0.00');
  });

  it('uses ×100M KRW (divide by 1e8), not millions', () => {
    expect(formatVolume100MKrw(128_942_127_870.82)).toBe('1,289.42');
    expect(formatVolume100MKrw(100_000_000)).toBe('1');
  });

  it('renders an em dash for missing or non-finite values, not a frozen 0', () => {
    expect(formatKrw(undefined)).toBe(FX_EM_DASH);
    expect(formatUsd(Number.NaN)).toBe(FX_EM_DASH);
    expect(formatJpy(Number.POSITIVE_INFINITY)).toBe(FX_EM_DASH);
    expect(formatSignedPct(undefined)).toBe(FX_EM_DASH);
    expect(formatVolume100MKrw(undefined)).toBe(FX_EM_DASH);
    expect(formatKrw(0)).toBe('0');
  });
});
