import type { Rate } from './types';

/** Missing/invalid FX must never render as a frozen current figure. */
export const FX_EM_DASH = '—';

function formatFixed(value: number | undefined, fractionDigits: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return FX_EM_DASH;
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatUsdKrw(value: number | undefined): string {
  return formatFixed(value, 1);
}

export function formatJpyKrw(value: number | undefined): string {
  return formatFixed(value, 4);
}

export function formatUsdtKrw(value: number | undefined): string {
  return formatFixed(value, 1);
}

/** Short MM-DD when `ratesDate` is ISO YYYY-MM-DD; otherwise the raw string. */
export function formatRatesDateShort(ratesDate: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ratesDate);
  if (iso) {
    return `${iso[2]}-${iso[3]}`;
  }
  return ratesDate;
}

export function formatFxSourceBadge(rate: Rate | undefined): string | null {
  if (!rate) {
    return null;
  }
  const date = formatRatesDateShort(rate.ratesDate);
  return `${rate.source} ${date}`;
}
