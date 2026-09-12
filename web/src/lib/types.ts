/**
 * Aggregator contract types — re-exported from the server package (single source of truth).
 *
 * Type-only boundary: the SPA never bundles server runtime code; TypeScript path aliases
 * in web/tsconfig.json point at server/src/core/types.ts. A dedicated shared package would
 * be cleaner at scale, but for v1 this avoids duplicated definitions without a Phase-0 refactor.
 */
export type {
  BinanceTicker,
  BitbankTicker,
  CoinSnapshot,
  FeedStatus,
  FxSnapshot,
  MarketSnapshot,
  Premium,
  PremiumInputTimestamps,
  Rate,
  Ticker,
  TickerBase,
  UpbitTicker,
} from '@kimchi/server-types';

export type { CoinSymbol, TargetExchange } from '@kimchi/server-symbols';
