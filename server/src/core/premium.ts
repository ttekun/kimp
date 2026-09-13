import type {
  BinanceTicker,
  BitbankTicker,
  FeedStatus,
  Premium,
  Rate,
  UpbitTicker,
} from './types.js';

/** Reject denominators at or below this absolute value (guards 0 and bogus near-zero prices). */
export const MIN_DENOMINATOR = 1e-9;

export interface PremiumBinanceInputs {
  upbit: UpbitTicker;
  binance: BinanceTicker;
  usdKrw: Rate | undefined;
  /** Display-only in v1; ignored by Pair A math (see docs/02-architecture.md). */
  usdtKrwImplied?: Rate;
  computedAt: number;
}

export interface PremiumBitbankInputs {
  upbit: UpbitTicker;
  bitbank: BitbankTicker;
  usdKrw: Rate | undefined;
  usdJpy: Rate | undefined;
  computedAt: number;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isUsableDenominator(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) > MIN_DENOMINATOR;
}

function isUsableRate(rate: Rate | undefined): rate is Rate {
  return rate !== undefined && isFinitePositive(rate.value);
}

function aggregateTickerStatus(...statuses: FeedStatus[]): FeedStatus | null {
  if (statuses.some((status) => status === 'down')) {
    return null;
  }

  if (statuses.some((status) => status === 'stale')) {
    return 'stale';
  }

  return 'live';
}

function buildPremium(
  upbit: UpbitTicker,
  target: BinanceTicker | BitbankTicker,
  fx: Rate,
  computedAt: number,
  pct: number,
  diffKrw: number,
): Premium | null {
  const status = aggregateTickerStatus(upbit.status, target.status);
  if (status === null || !Number.isFinite(pct) || !Number.isFinite(diffKrw)) {
    return null;
  }

  return {
    pct,
    diffKrw,
    computedAt,
    inputTs: {
      upbit: upbit.ts,
      target: target.ts,
      fx: fx.fetchedAt,
    },
    status,
  };
}

/** Pair B cross rate: KRW per JPY from a consistent USD/KRW and USD/JPY source. */
export function computeKrwPerJpy(usdKrw: number, usdJpy: number): number | null {
  if (!isFinitePositive(usdKrw) || !isFinitePositive(usdJpy) || !isUsableDenominator(usdJpy)) {
    return null;
  }

  const value = usdKrw / usdJpy;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Pair A (Upbit vs Binance):
 *   binanceKrw = P_binance * FX_usdkrw
 *   premiumPct = (P_upbit / binanceKrw - 1) * 100
 *   diffKrw    = P_upbit - binanceKrw
 */
export function computePremiumBinance(inputs: PremiumBinanceInputs): Premium | null {
  const { upbit, binance, usdKrw, computedAt } = inputs;

  if (!isUsableRate(usdKrw) || !isFinitePositive(upbit.price) || !isFinitePositive(binance.price)) {
    return null;
  }

  const binanceKrw = binance.price * usdKrw.value;
  if (!isUsableDenominator(binanceKrw)) {
    return null;
  }

  const pct = (upbit.price / binanceKrw - 1) * 100;
  const diffKrw = upbit.price - binanceKrw;

  return buildPremium(upbit, binance, usdKrw, computedAt, pct, diffKrw);
}

/**
 * Pair B (Upbit vs Bitbank):
 *   krwPerJpy  = FX_usdkrw / FX_usdjpy
 *   bitbankKrw = P_bitbank * krwPerJpy
 *   premiumPct = (P_upbit / bitbankKrw - 1) * 100
 *   diffKrw    = P_upbit - bitbankKrw
 */
export function computePremiumBitbank(inputs: PremiumBitbankInputs): Premium | null {
  const { upbit, bitbank, usdKrw, usdJpy, computedAt } = inputs;

  if (
    !isUsableRate(usdKrw) ||
    !isUsableRate(usdJpy) ||
    !isFinitePositive(upbit.price) ||
    !isFinitePositive(bitbank.price)
  ) {
    return null;
  }

  const krwPerJpy = computeKrwPerJpy(usdKrw.value, usdJpy.value);
  if (krwPerJpy === null) {
    return null;
  }

  const bitbankKrw = bitbank.price * krwPerJpy;
  if (!isUsableDenominator(bitbankKrw)) {
    return null;
  }

  const pct = (upbit.price / bitbankKrw - 1) * 100;
  const diffKrw = upbit.price - bitbankKrw;

  const fxForInputTs: Rate = {
    ...usdKrw,
    fetchedAt: Math.min(usdKrw.fetchedAt, usdJpy.fetchedAt),
  };

  return buildPremium(upbit, bitbank, fxForInputTs, computedAt, pct, diffKrw);
}
