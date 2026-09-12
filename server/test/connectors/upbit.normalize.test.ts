import { describe, expect, it } from 'vitest';

import {
  normalizeUpbitRestResponse,
  normalizeUpbitWireTicker,
} from '../../src/connectors/upbit.js';
import { COIN_SYMBOLS } from '../../src/core/symbols.js';
import {
  upbitMalformedFixtures,
  upbitRestFixture,
  upbitWsBtcFixture,
  upbitWsUsdtFixture,
} from './fixtures/upbit.js';

describe('normalizeUpbitWireTicker', () => {
  it('normalizes each live-recorded REST coin ticker with ×100 change rate', () => {
    const expectations: Array<{
      coin: (typeof COIN_SYMBOLS)[number];
      price: number;
      ts: number;
    }> = [
      {
        coin: 'BTC',
        price: 89_167_000,
        ts: 1_786_885_305_230,
      },
      {
        coin: 'ETH',
        price: 2_660_000,
        ts: 1_786_885_304_902,
      },
      {
        coin: 'XRP',
        price: 1_416,
        ts: 1_786_885_304_585,
      },
      {
        coin: 'SOL',
        price: 106_500,
        ts: 1_786_885_299_496,
      },
      {
        coin: 'DOT',
        price: 1_079,
        ts: 1_786_885_121_808,
      },
      {
        coin: 'DOGE',
        price: 140,
        ts: 1_786_885_121_808,
      },
    ];

    for (const [index, expected] of expectations.entries()) {
      const fixture = upbitRestFixture[index]!;
      const result = normalizeUpbitWireTicker(fixture);
      expect(result?.kind).toBe('coin_ticker');
      if (result?.kind !== 'coin_ticker') {
        continue;
      }

      expect(result.coin).toBe(expected.coin);
      expect(result.ticker.price).toBe(expected.price);
      expect(result.ticker.change24hPct).toBe(fixture.signed_change_rate * 100);
      expect(result.ticker.volume24hKrw).toBe(fixture.acc_trade_price_24h);
      expect(result.ticker.ts).toBe(expected.ts);
      expect(result.ticker.status).toBe('live');
    }
  });

  it('normalizes KRW-USDT WS payload (code field) as an implied rate', () => {
    const result = normalizeUpbitWireTicker(upbitWsUsdtFixture);

    expect(result).toEqual({
      kind: 'usdt_rate',
      rate: {
        value: 1415,
        fetchedAt: 1_786_885_306_497,
        source: 'upbit',
        ratesDate: '2026-08-16',
      },
    });
    expect('market' in upbitWsUsdtFixture).toBe(false);
    expect(upbitWsUsdtFixture.code).toBe('KRW-USDT');
  });

  it('normalizes WS-shaped ticker payloads that use code instead of market', () => {
    const result = normalizeUpbitWireTicker(upbitWsBtcFixture);

    expect(result?.kind).toBe('coin_ticker');
    if (result?.kind === 'coin_ticker') {
      expect(result.coin).toBe('BTC');
      expect(result.ticker.price).toBe(89_167_000);
    }
    expect('market' in upbitWsBtcFixture).toBe(false);
    expect(upbitWsBtcFixture.code).toBe('KRW-BTC');
  });

  it('regression: WS wire shape with code only (no market) must normalize', () => {
    const wsOnlyPayload = {
      type: 'ticker',
      code: 'KRW-ETH',
      trade_price: 2_660_000,
      signed_change_rate: -0.0007513148,
      acc_trade_price_24h: 8_226_297_605.56365,
      timestamp: 1_786_885_304_902,
      trade_date: '20260816',
    };

    const result = normalizeUpbitWireTicker(wsOnlyPayload);

    expect(result).toEqual({
      kind: 'coin_ticker',
      coin: 'ETH',
      ticker: {
        price: 2_660_000,
        change24hPct: -0.07513148,
        volume24hKrw: 8_226_297_605.56365,
        ts: 1_786_885_304_902,
        status: 'live',
      },
    });
  });

  it.each([
    ['missing market or code', upbitMalformedFixtures.missingMarketOrCode],
    ['wrong trade_price type', upbitMalformedFixtures.wrongTypePrice],
    ['unknown REST market code', upbitMalformedFixtures.unknownMarket],
    ['unknown WS code', upbitMalformedFixtures.unknownWsCode],
    ['negative acc_trade_price_24h', upbitMalformedFixtures.negativeVolume24h],
    ['null payload', null],
    ['non-object payload', 'ticker'],
  ])('returns null for malformed input: %s', (_label, payload) => {
    expect(normalizeUpbitWireTicker(payload)).toBeNull();
  });
});

describe('normalizeUpbitRestResponse', () => {
  it('parses the full REST array into coin tickers and USDT rate', () => {
    const result = normalizeUpbitRestResponse(upbitRestFixture);

    expect(result.tickers).toHaveLength(COIN_SYMBOLS.length);
    expect(result.tickers.map((entry) => entry.coin)).toEqual([...COIN_SYMBOLS]);
    expect(result.usdtRate).toMatchObject({
      value: 1415,
      source: 'upbit',
      ratesDate: '2026-08-16',
    });
  });

  it('returns empty results for non-array REST payloads', () => {
    expect(normalizeUpbitRestResponse({})).toEqual({ tickers: [], usdtRate: null });
    expect(normalizeUpbitRestResponse('bad')).toEqual({ tickers: [], usdtRate: null });
  });
});
