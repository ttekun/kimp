import type { CoinSymbol, CoinSnapshot, FeedStatus, MarketSnapshot, Premium } from './types';

export const COIN_SYMBOLS = ['BTC', 'ETH', 'XRP', 'SOL', 'DOT', 'DOGE'] as const;

type AssertSameCoins =
  Exclude<CoinSymbol, (typeof COIN_SYMBOLS)[number]> extends never
    ? Exclude<(typeof COIN_SYMBOLS)[number], CoinSymbol> extends never
      ? true
      : never
    : never;
const assertWebCoinsMatchServer: AssertSameCoins = true;
void assertWebCoinsMatchServer;

export type PremiumPair = 'binance' | 'bitbank';

export type PremiumTableSortKey =
  'coin' | 'target' | 'targetKrw' | 'upbit' | 'change' | 'volume' | 'premium';

export type SortDirection = 'asc' | 'desc';

export interface PremiumTableRow {
  symbol: CoinSymbol;
  targetPrice: number | undefined;
  targetKrw: number | undefined;
  upbitPrice: number | undefined;
  change24hPct: number | undefined;
  volume24hKrw: number | undefined;
  premiumPct: number | undefined;
  premiumDiffKrw: number | undefined;
  premiumStatus: FeedStatus | 'missing';
  upbitStatus: FeedStatus | 'missing';
  targetStatus: FeedStatus | 'missing';
  oldestInputTs: number | undefined;
  snapshotUpdatedAt: number;
}

function targetKrwForPair(
  pair: PremiumPair,
  coin: CoinSnapshot,
  snapshot: MarketSnapshot,
): number | undefined {
  if (pair === 'binance') {
    const price = coin.binance?.price;
    const fx = snapshot.fx.usdKrw?.value;
    if (
      price === undefined ||
      fx === undefined ||
      !Number.isFinite(price) ||
      !Number.isFinite(fx)
    ) {
      return undefined;
    }
    return price * fx;
  }

  const price = coin.bitbank?.price;
  const fx = snapshot.fx.krwPerJpy;
  if (price === undefined || fx === undefined || !Number.isFinite(price) || !Number.isFinite(fx)) {
    return undefined;
  }
  return price * fx;
}

function premiumForPair(pair: PremiumPair, coin: CoinSnapshot): Premium | undefined {
  return pair === 'binance' ? coin.premiumBinance : coin.premiumBitbank;
}

export function buildPremiumTableRows(
  snapshot: MarketSnapshot | null,
  pair: PremiumPair,
): PremiumTableRow[] {
  if (snapshot === null) {
    return COIN_SYMBOLS.map((symbol) => ({
      symbol,
      targetPrice: undefined,
      targetKrw: undefined,
      upbitPrice: undefined,
      change24hPct: undefined,
      volume24hKrw: undefined,
      premiumPct: undefined,
      premiumDiffKrw: undefined,
      premiumStatus: 'missing',
      upbitStatus: 'missing',
      targetStatus: 'missing',
      oldestInputTs: undefined,
      snapshotUpdatedAt: 0,
    }));
  }

  return COIN_SYMBOLS.map((symbol) => {
    const coin = snapshot.coins[symbol];
    const premium = premiumForPair(pair, coin);
    const target = pair === 'binance' ? coin.binance : coin.bitbank;

    return {
      symbol,
      targetPrice: target?.unavailable ? undefined : target?.price,
      targetKrw: target?.unavailable ? undefined : targetKrwForPair(pair, coin, snapshot),
      upbitPrice: coin.upbit?.price,
      change24hPct: coin.upbit?.change24hPct,
      volume24hKrw: coin.upbit?.volume24hKrw,
      premiumPct: premium?.pct,
      premiumDiffKrw: premium?.diffKrw,
      premiumStatus: premium?.status ?? 'missing',
      upbitStatus: coin.upbit?.status ?? 'missing',
      targetStatus: target?.status ?? 'missing',
      oldestInputTs: oldestDefinedTs(coin.upbit?.ts, target?.ts),
      snapshotUpdatedAt: snapshot.updatedAt,
    };
  });
}

function sortValue(row: PremiumTableRow, key: PremiumTableSortKey): number | string | undefined {
  switch (key) {
    case 'coin':
      return row.symbol;
    case 'target':
      return row.targetPrice;
    case 'targetKrw':
      return row.targetKrw;
    case 'upbit':
      return row.upbitPrice;
    case 'change':
      return row.change24hPct;
    case 'volume':
      return row.volume24hKrw;
    case 'premium':
      return row.premiumPct;
  }
}

function compareNullable(
  a: number | string | undefined,
  b: number | string | undefined,
  direction: SortDirection,
): number {
  const aMissing = a === undefined;
  const bMissing = b === undefined;
  if (aMissing && bMissing) {
    return 0;
  }
  if (aMissing) {
    return 1;
  }
  if (bMissing) {
    return -1;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
  }
  const an = a as number;
  const bn = b as number;
  return direction === 'asc' ? an - bn : bn - an;
}

/**
 * Live premiums sort by the chosen key; stale rows sort after live when the key is premium;
 * missing/down premiums are always last (nulls-last).
 */
export function sortPremiumTableRows(
  rows: readonly PremiumTableRow[],
  key: PremiumTableSortKey,
  direction: SortDirection,
): PremiumTableRow[] {
  return [...rows].sort((left, right) => {
    if (key === 'premium') {
      const leftLive = left.premiumStatus === 'live';
      const rightLive = right.premiumStatus === 'live';
      if (leftLive !== rightLive) {
        return leftLive ? -1 : 1;
      }
    }
    return compareNullable(sortValue(left, key), sortValue(right, key), direction);
  });
}

function oldestDefinedTs(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  return Math.min(...present);
}

export function staleAgeTooltip(row: PremiumTableRow): string | undefined {
  if (!rowIsStale(row) || row.oldestInputTs === undefined) {
    return undefined;
  }
  const ageSec = Math.max(0, Math.round((row.snapshotUpdatedAt - row.oldestInputTs) / 1000));
  return `last update ${ageSec}s ago`;
}

export function rowIsStale(row: PremiumTableRow): boolean {
  return (
    row.premiumStatus === 'stale' || row.upbitStatus === 'stale' || row.targetStatus === 'stale'
  );
}

export function rowOmitsPremium(row: PremiumTableRow): boolean {
  return row.premiumStatus === 'missing' || row.premiumStatus === 'down';
}
