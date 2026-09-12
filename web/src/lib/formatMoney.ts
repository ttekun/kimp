import { FX_EM_DASH } from './formatFx';

const KRW_100M = 100_000_000;

const krwFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const jpyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const volumeFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const signedKrwFmt = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

export function formatKrw(value: number | undefined, signed = false): string {
  if (!isFiniteNumber(value)) {
    return FX_EM_DASH;
  }
  return (signed ? signedKrwFmt : krwFmt).format(value);
}

export function formatUsd(value: number | undefined): string {
  if (!isFiniteNumber(value)) {
    return FX_EM_DASH;
  }
  return usdFmt.format(value);
}

export function formatJpy(value: number | undefined): string {
  if (!isFiniteNumber(value)) {
    return FX_EM_DASH;
  }
  return jpyFmt.format(value);
}

export function formatSignedPct(value: number | undefined): string {
  if (!isFiniteNumber(value)) {
    return FX_EM_DASH;
  }
  return pctFmt.format(value);
}

/** Upbit 24h KRW volume in the original site's ×100M KRW unit. */
export function formatVolume100MKrw(value: number | undefined): string {
  if (!isFiniteNumber(value)) {
    return FX_EM_DASH;
  }
  return volumeFmt.format(value / KRW_100M);
}
