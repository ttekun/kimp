import { describe, expect, it } from 'vitest';
import { normalizeBinanceWsMessage } from '../../src/connectors/binanceWire.js';
import { evaluateBitbankBook } from '../../src/connectors/bitbankWire.js';
import { normalizeUpbitWireTicker } from '../../src/connectors/upbitWire.js';
import {
  normalizeErApiResponse,
  normalizeFrankfurterResponse,
} from '../../src/connectors/fxNormalize.js';

describe('external input regressions', () => {
  it.each(['12junk', '1,234', '0x10', ' ', '1e'])(
    'rejects partial numeric strings: %s',
    (price) => {
      expect(evaluateBitbankBook(price, '10000')).toBeNull();
      expect(
        normalizeBinanceWsMessage({
          stream: 'btcusdt@miniTicker',
          data: {
            e: '24hrMiniTicker',
            E: 1000,
            s: 'BTCUSDT',
            c: price,
            o: '1',
            h: '1',
            l: '1',
            v: '1',
            q: '1',
          },
        }),
      ).toBeNull();
    },
  );
  it.each([0, -1])('rejects non-positive Upbit prices: %s', (trade_price) => {
    expect(
      normalizeUpbitWireTicker({
        code: 'KRW-BTC',
        trade_price,
        signed_change_rate: 0,
        acc_trade_price_24h: 0,
        timestamp: 1000,
      }),
    ).toBeNull();
  });
  it('rejects an out-of-range timestamp without throwing', () => {
    expect(
      normalizeUpbitWireTicker({
        code: 'KRW-USDT',
        trade_price: 1400,
        signed_change_rate: 0,
        acc_trade_price_24h: 0,
        timestamp: 9e15,
      }),
    ).toBeNull();
  });
  it('rejects FX responses with the wrong base or amount', () => {
    expect(
      normalizeErApiResponse(
        {
          result: 'success',
          base_code: 'EUR',
          time_last_update_unix: 1000,
          time_last_update_utc: 'date',
          time_next_update_unix: 2000,
          time_next_update_utc: 'date',
          rates: { KRW: 1400, JPY: 150 },
        },
        1000,
      ),
    ).toBeNull();
    expect(
      normalizeFrankfurterResponse(
        { amount: 100, base: 'USD', date: '2026-09-13', rates: { KRW: 140000, JPY: 15000 } },
        1000,
      ),
    ).toBeNull();
  });
});

it('rejects inherited object keys as exchange symbols', () => {
  for (const code of ['__proto__', 'constructor', 'toString']) {
    expect(
      normalizeUpbitWireTicker({
        code,
        trade_price: 1400,
        signed_change_rate: 0,
        acc_trade_price_24h: 0,
        timestamp: 1000,
      }),
    ).toBeNull();
    expect(
      normalizeBinanceWsMessage({
        stream: 'test',
        data: {
          e: '24hrMiniTicker',
          E: 1000,
          s: code,
          c: '10',
          o: '1',
          h: '1',
          l: '1',
          v: '1',
          q: '1',
        },
      }),
    ).toBeNull();
  }
});
