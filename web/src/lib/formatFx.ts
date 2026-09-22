import type { FeedStatus, Rate } from './types';

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

/** "HH:MM UTC" from the provider's publication instant (falls back to fetch time). */
export function formatFxReferenceTime(rate: Rate | undefined): string | null {
  if (!rate) {
    return null;
  }
  const at = rate.observedAt ?? rate.fetchedAt;
  if (!Number.isFinite(at)) {
    return null;
  }
  const iso = new Date(at).toISOString();
  return `${iso.slice(11, 16)} UTC`;
}

export type FxFreshnessMode = 'daily' | 'stale' | 'unavailable';

/** All current providers (er-api, Frankfurter) are once-daily; there is no intraday source wired in. */
export function fxFreshnessMode(status: FeedStatus): FxFreshnessMode {
  if (status === 'down') {
    return 'unavailable';
  }
  if (status === 'stale') {
    return 'stale';
  }
  return 'daily';
}

export function formatFxFreshnessLabel(status: FeedStatus): string {
  switch (fxFreshnessMode(status)) {
    case 'daily':
      return 'daily rate';
    case 'stale':
      return 'daily rate — stale';
    case 'unavailable':
      return 'unavailable';
  }
}
