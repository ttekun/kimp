import { FX_EM_DASH } from './formatFx';
import { formatKrw, formatSignedPct } from './formatMoney';
import {
  buildPremiumTableRows,
  rowIsStale,
  rowOmitsPremium,
  staleAgeTooltip,
  type PremiumTableRow,
} from './premiumTable';
import type { CoinSymbol, MarketSnapshot } from './types';

export interface HeroPremiumView {
  text: string;
  omit: boolean;
  stale: boolean;
  sign: 'up' | 'down' | undefined;
  tooltip: string | undefined;
}

export function krwToUsd(krw: number | undefined, usdKrw: number | undefined): number | undefined {
  if (
    krw === undefined ||
    usdKrw === undefined ||
    !Number.isFinite(krw) ||
    !Number.isFinite(usdKrw) ||
    Math.abs(usdKrw) < 1e-9
  ) {
    return undefined;
  }
  return krw / usdKrw;
}

export function selectHeroRows(
  snapshot: MarketSnapshot | null,
  symbol: CoinSymbol,
): { binance: PremiumTableRow; bitbank: PremiumTableRow } {
  const binance = buildPremiumTableRows(snapshot, 'binance').find((row) => row.symbol === symbol);
  const bitbank = buildPremiumTableRows(snapshot, 'bitbank').find((row) => row.symbol === symbol);
  if (!binance || !bitbank) {
    throw new Error(`missing hero rows for ${symbol}`);
  }
  return { binance, bitbank };
}

/**
 * Down/missing premiums render as an em dash. Never keep a leftover placeholder
 * (e.g. -0.26%) or a frozen last value styled as current.
 */
export function formatHeroPremium(row: PremiumTableRow): HeroPremiumView {
  const stale = rowIsStale(row);
  const tooltip = staleAgeTooltip(row);

  if (rowOmitsPremium(row)) {
    return {
      text: FX_EM_DASH,
      omit: true,
      stale,
      sign: undefined,
      tooltip,
    };
  }

  const pctText = row.premiumPct === undefined ? FX_EM_DASH : `${formatSignedPct(row.premiumPct)}%`;
  const diffText =
    row.premiumDiffKrw === undefined ? FX_EM_DASH : `KRW ${formatKrw(row.premiumDiffKrw, true)}`;
  const sign = row.premiumPct === undefined ? undefined : row.premiumPct >= 0 ? 'up' : 'down';

  return {
    text: `${pctText} / ${diffText}`,
    omit: false,
    stale,
    sign,
    tooltip,
  };
}
