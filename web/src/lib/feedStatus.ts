import type { CoinSymbol, FeedStatus, MarketSnapshot, Rate } from './types';

/**
 * Mirrors `STALENESS_THRESHOLDS.fx` in server/src/core/snapshot.ts (docs/02).
 * Locked by feedStatus.test.ts against the server export — do not invent other ages.
 */
export const FX_STALE_AFTER_MS = 26 * 60 * 60 * 1_000;
export const FX_DOWN_AFTER_MS = 78 * 60 * 60 * 1_000;

const COIN_SYMBOLS = ['BTC', 'ETH', 'XRP', 'SOL', 'DOT', 'DOGE'] as const;

type AssertSameCoins =
  Exclude<CoinSymbol, (typeof COIN_SYMBOLS)[number]> extends never
    ? Exclude<(typeof COIN_SYMBOLS)[number], CoinSymbol> extends never
      ? true
      : never
    : never;
const assertWebCoinsMatchServer: AssertSameCoins = true;
void assertWebCoinsMatchServer;

export type SnapshotExchange = 'upbit' | 'binance' | 'bitbank';

const STATUS_RANK: Record<FeedStatus, number> = {
  live: 0,
  stale: 1,
  down: 2,
};

/**
 * Exclusive stale/down boundaries, matching server `deriveFeedStatus`:
 * age == staleAfterMs is still live; age > staleAfterMs is stale; age > downAfterMs is down.
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

export function worstFeedStatus(statuses: readonly FeedStatus[]): FeedStatus {
  let worst: FeedStatus = 'live';
  for (const status of statuses) {
    if (STATUS_RANK[status] > STATUS_RANK[worst]) {
      worst = status;
    }
  }
  return worst;
}

/**
 * Per-exchange status: worst-of the listed coins. A missing ticker counts as `down`
 * so an empty snapshot never paints a live dot. DOT stale/down can redden that
 * exchange without changing the other exchanges' dots.
 */
export function deriveExchangeFeedStatus(
  snapshot: MarketSnapshot | null,
  exchange: SnapshotExchange,
): FeedStatus {
  if (snapshot === null) {
    return 'down';
  }

  const statuses: FeedStatus[] = COIN_SYMBOLS.map((symbol) => {
    const ticker = snapshot.coins[symbol][exchange];
    return ticker?.status ?? 'down';
  });

  return worstFeedStatus(statuses);
}

/**
 * Daily FX feed: `Rate` has no `status`. Age is `snapshot.updatedAt - fetchedAt`
 * with the same 26h / 78h exclusive thresholds as the aggregator.
 * Missing usdKrw (and missing usdJpy when that rate is present) never looks live.
 */
export function deriveFxFeedStatus(snapshot: MarketSnapshot | null): FeedStatus {
  if (snapshot === null) {
    return 'down';
  }

  const rates: Rate[] = [];
  if (snapshot.fx.usdKrw) {
    rates.push(snapshot.fx.usdKrw);
  }
  if (snapshot.fx.usdJpy) {
    rates.push(snapshot.fx.usdJpy);
  }

  if (rates.length === 0) {
    return 'down';
  }

  const statuses = rates.map((rate) =>
    deriveFeedStatus(rate.fetchedAt, snapshot.updatedAt, FX_STALE_AFTER_MS, FX_DOWN_AFTER_MS),
  );

  return worstFeedStatus(statuses);
}
