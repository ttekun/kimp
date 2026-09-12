import type { MarketSnapshot } from './types';

export type FxAttributionKind = 'er-api' | 'frankfurter' | 'unknown';

export const ER_API_ATTRIBUTION_LABEL = 'Rates By Exchange Rate API';
export const ER_API_ATTRIBUTION_HREF = 'https://www.exchangerate-api.com';

export function fxAttributionKind(snapshot: MarketSnapshot | null): FxAttributionKind {
  const source = snapshot?.fx.usdKrw?.source;
  if (source === 'er-api') {
    return 'er-api';
  }
  if (source === 'frankfurter') {
    return 'frankfurter';
  }
  return 'unknown';
}
