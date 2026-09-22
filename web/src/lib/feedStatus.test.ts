import { describe, expect, it } from 'vitest';

import { STALENESS_THRESHOLDS } from '../../../server/src/core/snapshot';
import {
  deriveExchangeFeedStatus,
  deriveFeedStatus,
  deriveFxFeedStatus,
  FX_DOWN_AFTER_MS,
  FX_STALE_AFTER_MS,
  worstFeedStatus,
} from './feedStatus';
import type { FeedStatus, MarketSnapshot, Rate, UpbitTicker } from './types';

const NOW = 1_700_000_000_000;

function rate(overrides: Partial<Rate> = {}): Rate {
  return {
    value: 1414.86,
    fetchedAt: NOW,
    source: 'er-api',
    ratesDate: '2026-08-16',
    ...overrides,
  };
}

function ticker(status: FeedStatus, ts = NOW): UpbitTicker {
  return { price: 1, ts, status, change24hPct: 0, volume24hKrw: 0 };
}

function emptyCoins(): MarketSnapshot['coins'] {
  return { BTC: {}, ETH: {}, XRP: {}, SOL: {}, DOT: {}, DOGE: {} };
}

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    updatedAt: NOW,
    fx: {},
    coins: emptyCoins(),
    ...overrides,
  };
}

function allExchangesLiveExceptDotDown(exchange: 'upbit' | 'binance' | 'bitbank'): MarketSnapshot {
  const live = ticker('live');
  const down = ticker('down');
  return snapshot({
    coins: {
      BTC: { [exchange]: live },
      ETH: { [exchange]: live },
      XRP: { [exchange]: live },
      SOL: { [exchange]: live },
      DOT: { [exchange]: down },
      DOGE: { [exchange]: live },
    },
  });
}

describe('FX staleness thresholds', () => {
  it('matches server STALENESS_THRESHOLDS.fx exactly (26h / 78h)', () => {
    expect(FX_STALE_AFTER_MS).toBe(STALENESS_THRESHOLDS.fx.staleAfterMs);
    expect(FX_DOWN_AFTER_MS).toBe(STALENESS_THRESHOLDS.fx.downAfterMs);
    expect(FX_STALE_AFTER_MS).toBe(26 * 60 * 60 * 1_000);
    expect(FX_DOWN_AFTER_MS).toBe(78 * 60 * 60 * 1_000);
  });
});

describe('deriveFeedStatus (exclusive boundaries)', () => {
  it('is live at age == staleAfterMs and stale one millisecond later', () => {
    expect(
      deriveFeedStatus(NOW, NOW + FX_STALE_AFTER_MS, FX_STALE_AFTER_MS, FX_DOWN_AFTER_MS),
    ).toBe('live');
    expect(
      deriveFeedStatus(NOW, NOW + FX_STALE_AFTER_MS + 1, FX_STALE_AFTER_MS, FX_DOWN_AFTER_MS),
    ).toBe('stale');
  });

  it('is stale at age == downAfterMs and down one millisecond later', () => {
    expect(deriveFeedStatus(NOW, NOW + FX_DOWN_AFTER_MS, FX_STALE_AFTER_MS, FX_DOWN_AFTER_MS)).toBe(
      'stale',
    );
    expect(
      deriveFeedStatus(NOW, NOW + FX_DOWN_AFTER_MS + 1, FX_STALE_AFTER_MS, FX_DOWN_AFTER_MS),
    ).toBe('down');
  });
});

describe('deriveFxFeedStatus', () => {
  it('is down when snapshot or FX rates are missing (never a live frozen number)', () => {
    expect(deriveFxFeedStatus(null)).toBe('down');
    expect(deriveFxFeedStatus(snapshot())).toBe('down');
  });

  it('derives from fetchedAt vs snapshot.updatedAt', () => {
    const live = snapshot({
      fx: { usdKrw: rate({ fetchedAt: NOW }) },
    });
    expect(deriveFxFeedStatus(live)).toBe('live');

    const stale = snapshot({
      fx: { usdKrw: rate({ fetchedAt: NOW - FX_STALE_AFTER_MS - 1 }) },
    });
    expect(deriveFxFeedStatus(stale)).toBe('stale');

    const down = snapshot({
      fx: { usdKrw: rate({ fetchedAt: NOW - FX_DOWN_AFTER_MS - 1 }) },
    });
    expect(deriveFxFeedStatus(down)).toBe('down');
  });

  it('uses worst-of usdKrw and usdJpy so a stale JPY leg cannot look live', () => {
    const mixed = snapshot({
      fx: {
        usdKrw: rate({ fetchedAt: NOW }),
        usdJpy: rate({ value: 159, fetchedAt: NOW - FX_STALE_AFTER_MS - 1 }),
      },
    });
    expect(deriveFxFeedStatus(mixed)).toBe('stale');
  });

  it('anchors staleness on observedAt, not fetchedAt: a freshly-fetched old rate is not live', () => {
    const freshlyFetchedButOld = snapshot({
      fx: {
        usdKrw: rate({ fetchedAt: NOW, observedAt: NOW - FX_STALE_AFTER_MS - 1 }),
      },
    });
    expect(deriveFxFeedStatus(freshlyFetchedButOld)).toBe('stale');
  });
});

describe('deriveExchangeFeedStatus', () => {
  it('is down on a null snapshot or when every ticker is missing', () => {
    expect(deriveExchangeFeedStatus(null, 'upbit')).toBe('down');
    expect(deriveExchangeFeedStatus(snapshot(), 'binance')).toBe('down');
  });

  it('is worst-of the coins, so DOT down reddens that exchange', () => {
    expect(deriveExchangeFeedStatus(allExchangesLiveExceptDotDown('upbit'), 'upbit')).toBe('down');
  });

  it('does not hide other exchanges behind DOT-down on one feed', () => {
    const snap = snapshot({
      coins: {
        BTC: {
          upbit: ticker('live'),
          binance: ticker('live'),
          bitbank: ticker('live'),
        },
        ETH: {
          upbit: ticker('live'),
          binance: ticker('live'),
          bitbank: ticker('live'),
        },
        XRP: {
          upbit: ticker('live'),
          binance: ticker('live'),
          bitbank: ticker('live'),
        },
        SOL: {
          upbit: ticker('live'),
          binance: ticker('live'),
          bitbank: ticker('live'),
        },
        DOT: {
          upbit: ticker('live'),
          binance: ticker('live'),
          bitbank: ticker('down'),
        },
        DOGE: {
          upbit: ticker('live'),
          binance: ticker('live'),
          bitbank: ticker('live'),
        },
      },
    });

    expect(deriveExchangeFeedStatus(snap, 'upbit')).toBe('live');
    expect(deriveExchangeFeedStatus(snap, 'binance')).toBe('live');
    expect(deriveExchangeFeedStatus(snap, 'bitbank')).toBe('down');
  });

  it('treats a missing coin ticker as down (not live)', () => {
    const snap = snapshot({
      coins: {
        BTC: { upbit: ticker('live') },
        ETH: { upbit: ticker('live') },
        XRP: { upbit: ticker('live') },
        SOL: { upbit: ticker('live') },
        DOT: {},
        DOGE: { upbit: ticker('live') },
      },
    });
    expect(deriveExchangeFeedStatus(snap, 'upbit')).toBe('down');
  });
});

describe('worstFeedStatus', () => {
  it('ranks down over stale over live', () => {
    expect(worstFeedStatus(['live', 'stale', 'live'])).toBe('stale');
    expect(worstFeedStatus(['live', 'down', 'stale'])).toBe('down');
    expect(worstFeedStatus(['live', 'live'])).toBe('live');
  });
});
