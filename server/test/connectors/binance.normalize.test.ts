import { describe, expect, it } from 'vitest';

import {
  normalizeBinanceRestResponse,
  normalizeBinanceWsMessage,
} from '../../src/connectors/binance.js';
import { COIN_SYMBOLS } from '../../src/core/symbols.js';
import {
  binanceMalformedFixtures,
  binanceRestFixture,
  binanceWsBtcFixture,
  binanceWsEthFixture,
  binanceWsSolFixture,
} from './fixtures/binance.js';

describe('normalizeBinanceWsMessage', () => {
  it('normalizes live-recorded BTC miniTicker using string close price and numeric event time', () => {
    const result = normalizeBinanceWsMessage(binanceWsBtcFixture);

    expect(result).toEqual({
      coin: 'BTC',
      ticker: {
        price: 63_067.02,
        ts: 1_786_887_568_015,
        status: 'live',
      },
    });
    expect(typeof binanceWsBtcFixture.data.c).toBe('string');
    expect(typeof binanceWsBtcFixture.data.E).toBe('number');
  });

  it('normalizes live-recorded ETH and SOL miniTicker messages', () => {
    expect(normalizeBinanceWsMessage(binanceWsEthFixture)).toEqual({
      coin: 'ETH',
      ticker: {
        price: 1_881.33,
        ts: 1_786_887_569_015,
        status: 'live',
      },
    });

    expect(normalizeBinanceWsMessage(binanceWsSolFixture)).toEqual({
      coin: 'SOL',
      ticker: {
        price: 75.39,
        ts: 1_786_887_569_797,
        status: 'live',
      },
    });
  });

  it.each([
    ['missing stream wrapper', binanceMalformedFixtures.missingStream],
    ['wrong event type', binanceMalformedFixtures.wrongEventType],
    ['wrong price type', binanceMalformedFixtures.wrongPriceType],
    ['unknown symbol', binanceMalformedFixtures.unknownSymbol],
    ['negative price', binanceMalformedFixtures.negativePrice],
    ['null payload', null],
    ['non-object payload', 'ticker'],
  ])('returns null for malformed input: %s', (_label, payload) => {
    expect(normalizeBinanceWsMessage(payload)).toBeNull();
  });
});

describe('normalizeBinanceRestResponse', () => {
  it('parses the full REST array into coin tickers with string lastPrice', () => {
    const result = normalizeBinanceRestResponse(binanceRestFixture);

    expect(result.tickers).toHaveLength(COIN_SYMBOLS.length);
    expect(result.tickers.map((entry) => entry.coin)).toEqual([...COIN_SYMBOLS]);

    expect(result.tickers[0]).toEqual({
      coin: 'BTC',
      ticker: {
        price: 63_067.01,
        ts: 1_786_887_587_001,
        status: 'live',
      },
    });

    expect(typeof binanceRestFixture[0]!.lastPrice).toBe('string');
    expect(typeof binanceRestFixture[0]!.closeTime).toBe('number');
  });

  it('returns empty results for non-array REST payloads', () => {
    expect(normalizeBinanceRestResponse({})).toEqual({ tickers: [] });
    expect(normalizeBinanceRestResponse('bad')).toEqual({ tickers: [] });
  });

  it('skips malformed rows without rejecting the entire array', () => {
    const result = normalizeBinanceRestResponse([
      binanceRestFixture[0],
      binanceMalformedFixtures.restWrongPriceType,
      binanceRestFixture[1],
    ]);

    expect(result.tickers).toHaveLength(2);
    expect(result.tickers.map((entry) => entry.coin)).toEqual(['BTC', 'ETH']);
  });

  it('returns null-equivalent empty tickers for unknown REST symbols only', () => {
    const result = normalizeBinanceRestResponse([binanceMalformedFixtures.restUnknownSymbol]);
    expect(result.tickers).toEqual([]);
  });
});
