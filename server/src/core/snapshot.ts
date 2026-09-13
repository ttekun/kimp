import { computeKrwPerJpy, computePremiumBinance, computePremiumBitbank } from './premium.js';
import { COIN_SYMBOLS, type CoinSymbol } from './symbols.js';
import type {
  BinanceTicker,
  BitbankTicker,
  CoinSnapshot,
  FeedStatus,
  FxSnapshot,
  MarketSnapshot,
  Premium,
  Rate,
  Ticker,
  UpbitTicker,
} from './types.js';

/** Staleness thresholds from docs/02-architecture.md (Price Basis, Timestamp Alignment & Staleness Invariant). */
export const STALENESS_THRESHOLDS = {
  upbit: { staleAfterMs: 15_000, downAfterMs: 60_000 },
  binance: { staleAfterMs: 15_000, downAfterMs: 60_000 },
  bitbank: { staleAfterMs: 30_000, downAfterMs: 120_000 },
  fx: { staleAfterMs: 26 * 60 * 60 * 1_000, downAfterMs: 78 * 60 * 60 * 1_000 },
  crossExchangeSkew: { maxSkewMs: 30_000 },
} as const;

export type SnapshotExchange = 'upbit' | 'binance' | 'bitbank';
export type FxRateKind = 'usdKrw' | 'usdJpy' | 'usdtKrwImplied';

/**
 * Derives live/stale/down from source timestamp age.
 * Boundaries are exclusive on the stale/down side: age == staleAfterMs is still live;
 * age > staleAfterMs is stale; age > downAfterMs is down.
 */
export function deriveFeedStatus(
  tickTs: number,
  now: number,
  staleAfterMs: number,
  downAfterMs: number,
): FeedStatus {
  const ageMs = now - tickTs;
  if (ageMs > downAfterMs) {
    return 'down';
  }
  if (ageMs > staleAfterMs) {
    return 'stale';
  }
  return 'live';
}

function deriveFxStatus(rate: Rate, now: number): FeedStatus {
  return deriveFeedStatus(
    rate.fetchedAt,
    now,
    STALENESS_THRESHOLDS.fx.staleAfterMs,
    STALENESS_THRESHOLDS.fx.downAfterMs,
  );
}

function deriveUpbitStatus(ticker: UpbitTicker, now: number): UpbitTicker {
  return {
    ...ticker,
    status: ticker.unavailable
      ? 'down'
      : deriveFeedStatus(
          ticker.ts,
          now,
          STALENESS_THRESHOLDS.upbit.staleAfterMs,
          STALENESS_THRESHOLDS.upbit.downAfterMs,
        ),
  };
}

function deriveBinanceStatus(ticker: BinanceTicker, now: number): BinanceTicker {
  return {
    ...ticker,
    status: ticker.unavailable
      ? 'down'
      : deriveFeedStatus(
          ticker.ts,
          now,
          STALENESS_THRESHOLDS.binance.staleAfterMs,
          STALENESS_THRESHOLDS.binance.downAfterMs,
        ),
  };
}

function deriveBitbankStatus(ticker: BitbankTicker, now: number): BitbankTicker {
  return {
    ...ticker,
    status: ticker.unavailable
      ? 'down'
      : deriveFeedStatus(
          ticker.ts,
          now,
          STALENESS_THRESHOLDS.bitbank.staleAfterMs,
          STALENESS_THRESHOLDS.bitbank.downAfterMs,
        ),
  };
}

function deriveTickerStatus(exchange: SnapshotExchange, ticker: Ticker, now: number): Ticker {
  switch (exchange) {
    case 'upbit':
      return deriveUpbitStatus(ticker as UpbitTicker, now);
    case 'binance':
      return deriveBinanceStatus(ticker as BinanceTicker, now);
    case 'bitbank':
      return deriveBitbankStatus(ticker as BitbankTicker, now);
  }
}

// Skew violation while both tickers are still independently "live" by age is only reachable
// via clock skew between exchange servers (out-of-order delivery), not under normal operation.
function isSkewExceeded(upbitTs: number, targetTs: number): boolean {
  return Math.abs(upbitTs - targetTs) > STALENESS_THRESHOLDS.crossExchangeSkew.maxSkewMs;
}

function downgradePremiumForDerivedInputs(
  premium: Premium,
  options: { skewExceeded: boolean; fxStale: boolean },
): Premium {
  let { status } = premium;
  if (status === 'live' && (options.skewExceeded || options.fxStale)) {
    status = 'stale';
  }
  return status === premium.status ? premium : { ...premium, status };
}

function computeCoinPremiumBinance(
  upbit: UpbitTicker | undefined,
  binance: BinanceTicker | undefined,
  usdKrw: Rate | undefined,
  now: number,
): Premium | undefined {
  if (!upbit || !binance) {
    return undefined;
  }

  const derivedUpbit = deriveUpbitStatus(upbit, now);
  const derivedBinance = deriveBinanceStatus(binance, now);
  const skewExceeded = isSkewExceeded(derivedUpbit.ts, derivedBinance.ts);

  const fxStatus = usdKrw ? deriveFxStatus(usdKrw, now) : 'down';
  const usdKrwForPremium = fxStatus === 'down' ? undefined : usdKrw;

  const premium = computePremiumBinance({
    upbit: derivedUpbit,
    binance: derivedBinance,
    usdKrw: usdKrwForPremium,
    computedAt: now,
  });

  if (!premium) {
    return undefined;
  }

  return downgradePremiumForDerivedInputs(premium, {
    skewExceeded,
    fxStale: fxStatus === 'stale',
  });
}

function computeCoinPremiumBitbank(
  upbit: UpbitTicker | undefined,
  bitbank: BitbankTicker | undefined,
  usdKrw: Rate | undefined,
  usdJpy: Rate | undefined,
  now: number,
): Premium | undefined {
  if (!upbit || !bitbank) {
    return undefined;
  }

  const derivedUpbit = deriveUpbitStatus(upbit, now);
  const derivedBitbank = deriveBitbankStatus(bitbank, now);
  const skewExceeded = isSkewExceeded(derivedUpbit.ts, derivedBitbank.ts);

  const usdKrwStatus = usdKrw ? deriveFxStatus(usdKrw, now) : 'down';
  const usdJpyStatus = usdJpy ? deriveFxStatus(usdJpy, now) : 'down';
  const usdKrwForPremium = usdKrwStatus === 'down' ? undefined : usdKrw;
  const usdJpyForPremium = usdJpyStatus === 'down' ? undefined : usdJpy;

  const premium = computePremiumBitbank({
    upbit: derivedUpbit,
    bitbank: derivedBitbank,
    usdKrw: usdKrwForPremium,
    usdJpy: usdJpyForPremium,
    computedAt: now,
  });

  if (!premium) {
    return undefined;
  }

  return downgradePremiumForDerivedInputs(premium, {
    skewExceeded,
    fxStale: usdKrwStatus === 'stale' || usdJpyStatus === 'stale',
  });
}

function recomputeKrwPerJpy(fx: FxSnapshot): FxSnapshot {
  if (fx.usdKrw === undefined || fx.usdJpy === undefined) {
    return { ...fx, krwPerJpy: undefined };
  }

  const krwPerJpy = computeKrwPerJpy(fx.usdKrw.value, fx.usdJpy.value) ?? undefined;
  return { ...fx, krwPerJpy };
}

function recomputeCoinSnapshot(coin: CoinSnapshot, fx: FxSnapshot, now: number): CoinSnapshot {
  const upbit = coin.upbit ? deriveUpbitStatus(coin.upbit, now) : undefined;
  const binance = coin.binance ? deriveBinanceStatus(coin.binance, now) : undefined;
  const bitbank = coin.bitbank ? deriveBitbankStatus(coin.bitbank, now) : undefined;

  const premiumBinance = computeCoinPremiumBinance(upbit, binance, fx.usdKrw, now);
  const premiumBitbank = computeCoinPremiumBitbank(upbit, bitbank, fx.usdKrw, fx.usdJpy, now);

  return {
    ...(upbit !== undefined && { upbit }),
    ...(binance !== undefined && { binance }),
    ...(bitbank !== undefined && { bitbank }),
    ...(premiumBinance !== undefined && { premiumBinance }),
    ...(premiumBitbank !== undefined && { premiumBitbank }),
  };
}

function recomputeAllCoins(
  coins: Record<CoinSymbol, CoinSnapshot>,
  fx: FxSnapshot,
  now: number,
): Record<CoinSymbol, CoinSnapshot> {
  const nextCoins = {} as Record<CoinSymbol, CoinSnapshot>;
  for (const symbol of COIN_SYMBOLS) {
    nextCoins[symbol] = recomputeCoinSnapshot(coins[symbol], fx, now);
  }
  return nextCoins;
}

/**
 * Re-derives ticker statuses, FX-driven premium rules, and premiums for every coin from
 * stored timestamps and the given `now`. Pure and immutable — safe to call periodically
 * (e.g. 1 Hz broadcast) without a synthetic merge when feeds go silent.
 */
export function recomputeSnapshot(snapshot: MarketSnapshot, now: number): MarketSnapshot {
  return {
    ...snapshot,
    updatedAt: now,
    coins: recomputeAllCoins(snapshot.coins, snapshot.fx, now),
  };
}

/** Initial snapshot: all coin keys present, feeds absent until connectors merge data. */
export function createEmptySnapshot(now: number): MarketSnapshot {
  const coins = {} as Record<CoinSymbol, CoinSnapshot>;
  for (const symbol of COIN_SYMBOLS) {
    coins[symbol] = {};
  }

  return {
    updatedAt: now,
    fx: {},
    coins,
  };
}

/**
 * Merges a ticker for one exchange+coin. Stored `Ticker.status` is overwritten with the
 * age-derived status at merge time so downstream readers always see current truth.
 */
export function mergeTicker(
  snapshot: MarketSnapshot,
  exchange: SnapshotExchange,
  coin: CoinSymbol,
  ticker: Ticker,
  now: number,
): MarketSnapshot {
  const existingCoin = snapshot.coins[coin];
  const existingTicker = existingCoin[exchange];

  // REST bootstrap and streaming data can arrive out of order. Never let an older
  // exchange timestamp replace the latest accepted price for the same feed.
  if (existingTicker !== undefined && ticker.ts < existingTicker.ts) {
    return recomputeSnapshot(snapshot, now);
  }

  const derivedTicker = deriveTickerStatus(exchange, ticker, now);

  return recomputeSnapshot(
    {
      ...snapshot,
      coins: {
        ...snapshot.coins,
        [coin]: { ...existingCoin, [exchange]: derivedTicker },
      },
    },
    now,
  );
}

/** Merges an FX rate and recomputes derived krwPerJpy plus premiums for every coin. */
export function mergeFxRate(
  snapshot: MarketSnapshot,
  kind: FxRateKind,
  rate: Rate,
  now: number,
  options: { acceptOlder?: boolean } = {},
): MarketSnapshot {
  const existingRate = snapshot.fx[kind];

  // The same ordering guarantee applies when delayed FX responses overlap.
  if (
    !options.acceptOlder &&
    existingRate !== undefined &&
    rate.fetchedAt < existingRate.fetchedAt
  ) {
    return recomputeSnapshot(snapshot, now);
  }

  const updatedFx = recomputeKrwPerJpy({
    ...snapshot.fx,
    [kind]: rate,
  });

  return recomputeSnapshot(
    {
      ...snapshot,
      fx: updatedFx,
    },
    now,
  );
}
