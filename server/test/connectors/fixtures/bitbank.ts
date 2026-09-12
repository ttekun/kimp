/**
 * Recorded from live Bitbank REST + Socket.IO on 2026-08-16.
 * Used as unit-test fixtures — tests must not call the network.
 */

/** REST GET /tickers envelope (target JPY rows used here). */
export const bitbankRestTickersFixture = {
  success: 1,
  data: [
    {
      pair: 'btc_jpy',
      sell: '10043109',
      buy: '10043108',
      open: '10048894',
      high: '10059552',
      low: '10030564',
      last: '10043109',
      vol: '11.2071',
      timestamp: 1_786_888_374_345,
    },
    {
      pair: 'eth_jpy',
      sell: '299645',
      buy: '299644',
      open: '300152',
      high: '300400',
      low: '299321',
      last: '299644',
      vol: '369.8904',
      timestamp: 1_786_888_374_290,
    },
    {
      pair: 'xrp_jpy',
      sell: '159.344',
      buy: '159.343',
      open: '159.650',
      high: '160.385',
      low: '159.000',
      last: '159.328',
      vol: '1562567.2173',
      timestamp: 1_786_888_374_354,
    },
    {
      pair: 'sol_jpy',
      sell: '12007.7',
      buy: '12007.6',
      open: '12041.7',
      high: '12056.0',
      low: '11982.7',
      last: '12008.0',
      vol: '3445.3445',
      timestamp: 1_786_888_374_315,
    },
    {
      pair: 'dot_jpy',
      sell: '121.733',
      buy: '121.326',
      open: '124.300',
      high: '124.300',
      low: '120.856',
      last: '121.758',
      vol: '3203.6747',
      timestamp: 1_786_888_374_169,
    },
    {
      pair: 'doge_jpy',
      sell: '13.403',
      buy: '13.402',
      open: '13.657',
      high: '13.817',
      low: '13.122',
      last: '13.402',
      vol: '13527041.1082',
      timestamp: 1_786_888_374_169,
    },
  ],
} as const;

/** Socket.IO `message` event for ticker_btc_jpy (live-captured). */
export const bitbankWsBtcFixture = {
  room_name: 'ticker_btc_jpy',
  message: {
    data: {
      sell: '10043109',
      buy: '10043108',
      open: '10048894',
      high: '10059552',
      low: '10030564',
      last: '10043109',
      vol: '11.2071',
      timestamp: 1_786_888_413_333,
    },
  },
} as const;

/** Socket.IO `message` event for ticker_eth_jpy (live-captured). */
export const bitbankWsEthFixture = {
  room_name: 'ticker_eth_jpy',
  message: {
    data: {
      sell: '299645',
      buy: '299644',
      open: '300152',
      high: '300400',
      low: '299321',
      last: '299645',
      vol: '370.2159',
      timestamp: 1_786_888_413_390,
    },
  },
} as const;

/** Socket.IO `message` event for ticker_xrp_jpy (live-captured). */
export const bitbankWsXrpFixture = {
  room_name: 'ticker_xrp_jpy',
  message: {
    data: {
      sell: '159.344',
      buy: '159.343',
      open: '159.650',
      high: '160.385',
      low: '159.000',
      last: '159.344',
      vol: '1562549.8374',
      timestamp: 1_786_888_413_216,
    },
  },
} as const;

/** Socket.IO circuit_break_info snapshot (live-captured, mode NONE). */
export const bitbankWsCircuitBreakNoneFixture = {
  room_name: 'circuit_break_info_btc_jpy',
  message: {
    data: {
      mode: 'NONE',
      estimated_itayose_price: null,
      estimated_itayose_amount: null,
      itayose_upper_price: null,
      itayose_lower_price: null,
      upper_trigger_price: '12051731',
      lower_trigger_price: '8034487',
      fee_type: 'NORMAL',
      reopen_timestamp: null,
      timestamp: 1_786_888_097_414,
    },
  },
} as const;

/** Socket.IO circuit_break_info snapshot (from official docs example shape). */
export const bitbankWsCircuitBreakActiveFixture = {
  room_name: 'circuit_break_info_xrp_jpy',
  message: {
    data: {
      mode: 'CIRCUIT_BREAK',
      estimated_itayose_price: '1000000',
      estimated_itayose_amount: null,
      itayose_upper_price: '1300000',
      itayose_lower_price: '800000',
      upper_trigger_price: null,
      lower_trigger_price: null,
      fee_type: 'SELL_MAKER',
      reopen_timestamp: 1_234_573_890_000,
      timestamp: 1_570_080_162_856,
    },
  },
} as const;

export const bitbankMalformedFixtures = {
  missingRoom: {
    message: bitbankWsBtcFixture.message,
  },
  wrongTimestampType: {
    room_name: 'ticker_btc_jpy',
    message: {
      data: {
        ...bitbankWsBtcFixture.message.data,
        timestamp: 'not-a-number',
      },
    },
  },
  unknownRoom: {
    room_name: 'ticker_ada_jpy',
    message: bitbankWsBtcFixture.message,
  },
  oneSidedSellZero: {
    room_name: 'ticker_btc_jpy',
    message: {
      data: {
        ...bitbankWsBtcFixture.message.data,
        sell: '0',
      },
    },
  },
  oneSidedNullSell: {
    room_name: 'ticker_btc_jpy',
    message: {
      data: {
        ...bitbankWsBtcFixture.message.data,
        sell: null,
      },
    },
  },
  oneSidedNullBuy: {
    room_name: 'ticker_btc_jpy',
    message: {
      data: {
        ...bitbankWsBtcFixture.message.data,
        buy: null,
      },
    },
  },
  crossedBook: {
    room_name: 'ticker_btc_jpy',
    message: {
      data: {
        ...bitbankWsBtcFixture.message.data,
        buy: '10050000',
        sell: '10040000',
      },
    },
  },
  nonNumericBuy: {
    room_name: 'ticker_btc_jpy',
    message: {
      data: {
        ...bitbankWsBtcFixture.message.data,
        buy: 'not-a-number',
      },
    },
  },
  numericBuyType: {
    room_name: 'ticker_btc_jpy',
    message: {
      data: {
        ...bitbankWsBtcFixture.message.data,
        buy: 10043108,
      },
    },
  },
  missingTimestamp: {
    room_name: 'ticker_btc_jpy',
    message: {
      data: {
        sell: bitbankWsBtcFixture.message.data.sell,
        buy: bitbankWsBtcFixture.message.data.buy,
        open: bitbankWsBtcFixture.message.data.open,
        high: bitbankWsBtcFixture.message.data.high,
        low: bitbankWsBtcFixture.message.data.low,
        last: bitbankWsBtcFixture.message.data.last,
        vol: bitbankWsBtcFixture.message.data.vol,
      },
    },
  },
};
