import { describe, expect, it } from 'vitest';

import {
  evaluateBitbankBook,
  isBitbankCircuitBreakActive,
  normalizeBitbankRestTickersResponse,
  normalizeBitbankWsMessage,
} from '../../src/connectors/bitbank.js';
import { COIN_SYMBOLS } from '../../src/core/symbols.js';
import {
  bitbankMalformedFixtures,
  bitbankRestTickersFixture,
  bitbankWsBtcFixture,
  bitbankWsEthFixture,
  bitbankWsXrpFixture,
} from './fixtures/bitbank.js';

describe('evaluateBitbankBook', () => {
  it('computes midpoint from string buy/sell quotes', () => {
    expect(evaluateBitbankBook('10043108', '10043109')).toBe(10_043_108.5);
    expect(evaluateBitbankBook('159.343', '159.344')).toBe(159.3435);
  });

  it('flags one-sided books when buy or sell is zero', () => {
    expect(evaluateBitbankBook('0', '10043109')).toBe('one_sided');
    expect(evaluateBitbankBook('10043108', '0')).toBe('one_sided');
  });

  it('flags one-sided books when buy or sell is null or undefined', () => {
    expect(evaluateBitbankBook(null, '10043109')).toBe('one_sided');
    expect(evaluateBitbankBook('10043108', null)).toBe('one_sided');
    expect(evaluateBitbankBook(undefined, '10043109')).toBe('one_sided');
    expect(evaluateBitbankBook('10043108', undefined)).toBe('one_sided');
  });

  it('flags crossed books when buy exceeds sell', () => {
    expect(evaluateBitbankBook('10050000', '10040000')).toBe('crossed');
  });

  it('returns null for non-numeric quotes', () => {
    expect(evaluateBitbankBook('not-a-number', '10043109')).toBeNull();
  });
});

describe('isBitbankCircuitBreakActive', () => {
  it('treats NONE as inactive and any other mode as active', () => {
    expect(isBitbankCircuitBreakActive('NONE')).toBe(false);
    expect(isBitbankCircuitBreakActive('CIRCUIT_BREAK')).toBe(true);
  });
});

describe('normalizeBitbankWsMessage', () => {
  it('normalizes live-recorded BTC ticker using string quotes and numeric timestamp', () => {
    const result = normalizeBitbankWsMessage(bitbankWsBtcFixture);

    expect(result).toEqual({
      kind: 'ticker',
      coin: 'BTC',
      ticker: {
        price: 10_043_108.5,
        ts: 1_786_888_413_333,
        status: 'live',
      },
    });
    expect(typeof bitbankWsBtcFixture.message.data.sell).toBe('string');
    expect(typeof bitbankWsBtcFixture.message.data.timestamp).toBe('number');
  });

  it('normalizes live-recorded ETH and XRP ticker messages', () => {
    expect(normalizeBitbankWsMessage(bitbankWsEthFixture)).toEqual({
      kind: 'ticker',
      coin: 'ETH',
      ticker: {
        price: 299_644.5,
        ts: 1_786_888_413_390,
        status: 'live',
      },
    });

    expect(normalizeBitbankWsMessage(bitbankWsXrpFixture)).toEqual({
      kind: 'ticker',
      coin: 'XRP',
      ticker: {
        price: 159.3435,
        ts: 1_786_888_413_216,
        status: 'live',
      },
    });
  });

  it.each([
    ['one-sided sell zero', bitbankMalformedFixtures.oneSidedSellZero, 'one_sided'],
    ['one-sided null sell', bitbankMalformedFixtures.oneSidedNullSell, 'one_sided'],
    ['one-sided null buy', bitbankMalformedFixtures.oneSidedNullBuy, 'one_sided'],
    ['crossed book', bitbankMalformedFixtures.crossedBook, 'crossed'],
  ])('returns book_unusable for %s without fabricating a mid-price', (_label, payload, reason) => {
    expect(normalizeBitbankWsMessage(payload)).toEqual({
      kind: 'book_unusable',
      coin: 'BTC',
      reason,
    });
  });

  it.each([
    ['missing room_name', bitbankMalformedFixtures.missingRoom],
    ['wrong timestamp type', bitbankMalformedFixtures.wrongTimestampType],
    ['unknown room', bitbankMalformedFixtures.unknownRoom],
    ['non-numeric buy', bitbankMalformedFixtures.nonNumericBuy],
    ['numeric buy type', bitbankMalformedFixtures.numericBuyType],
    ['missing timestamp', bitbankMalformedFixtures.missingTimestamp],
    ['null payload', null],
    ['non-object payload', 'ticker'],
  ])('returns null for malformed input: %s', (_label, payload) => {
    expect(normalizeBitbankWsMessage(payload)).toBeNull();
  });
});

describe('normalizeBitbankRestTickersResponse', () => {
  it('parses the batch REST response into coin mid-prices', () => {
    const result = normalizeBitbankRestTickersResponse(bitbankRestTickersFixture);

    expect(result.tickers).toHaveLength(COIN_SYMBOLS.length);
    expect(result.tickers.map((entry) => entry.coin)).toEqual([...COIN_SYMBOLS]);

    expect(result.tickers[0]).toEqual({
      coin: 'BTC',
      ticker: {
        price: 10_043_108.5,
        ts: 1_786_888_374_345,
        status: 'live',
      },
    });

    expect(typeof bitbankRestTickersFixture.data[0]!.sell).toBe('string');
    expect(typeof bitbankRestTickersFixture.data[0]!.timestamp).toBe('number');
  });

  it('returns empty results for non-object REST payloads', () => {
    expect(normalizeBitbankRestTickersResponse({})).toEqual({ tickers: [] });
    expect(normalizeBitbankRestTickersResponse('bad')).toEqual({ tickers: [] });
  });

  it('skips one-sided rows without rejecting the entire batch', () => {
    const result = normalizeBitbankRestTickersResponse({
      success: 1,
      data: [
        bitbankRestTickersFixture.data[0],
        {
          ...bitbankRestTickersFixture.data[1]!,
          sell: '0',
        },
        bitbankRestTickersFixture.data[2],
      ],
    });

    expect(result.tickers).toHaveLength(2);
    expect(result.tickers.map((entry) => entry.coin)).toEqual(['BTC', 'XRP']);
  });

  it('returns all five target tickers when irrelevant pairs have null quotes', () => {
    const irrelevantThinPair = {
      pair: 'mkr_jpy',
      sell: null,
      buy: null,
      open: '0',
      high: '0',
      low: '0',
      last: '0',
      vol: '0',
      timestamp: 1_786_888_374_000,
    };

    const result = normalizeBitbankRestTickersResponse({
      success: 1,
      data: [
        bitbankRestTickersFixture.data[0],
        irrelevantThinPair,
        bitbankRestTickersFixture.data[1],
        {
          pair: 'rndr_jpy',
          sell: null,
          buy: null,
          open: '0',
          high: '0',
          low: '0',
          last: '0',
          vol: '0',
          timestamp: 1_786_888_374_001,
        },
        ...bitbankRestTickersFixture.data.slice(2),
      ],
    });

    expect(result.tickers).toHaveLength(COIN_SYMBOLS.length);
    expect(result.tickers.map((entry) => entry.coin)).toEqual([...COIN_SYMBOLS]);
  });

  it('routes target-pair null quotes to one-sided handling instead of rejecting the row', () => {
    const normalized = normalizeBitbankRestTickersResponse({
      success: 1,
      data: [
        {
          ...bitbankRestTickersFixture.data[0]!,
          sell: null,
          buy: '10043108',
        },
      ],
    });

    expect(normalized.tickers).toHaveLength(0);

    expect(
      normalizeBitbankWsMessage({
        room_name: 'ticker_btc_jpy',
        message: {
          data: {
            ...bitbankWsBtcFixture.message.data,
            sell: null,
          },
        },
      }),
    ).toEqual({
      kind: 'book_unusable',
      coin: 'BTC',
      reason: 'one_sided',
    });
  });

  it('skips individually malformed target-pair rows without rejecting valid siblings', () => {
    const result = normalizeBitbankRestTickersResponse({
      success: 1,
      data: [
        {
          ...bitbankRestTickersFixture.data[0]!,
          timestamp: 'not-a-number',
        },
        bitbankRestTickersFixture.data[1],
      ],
    });

    expect(result.tickers).toHaveLength(1);
    expect(result.tickers[0]?.coin).toBe('ETH');
  });
});
