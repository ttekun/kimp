/**
 * Recorded from live Binance REST + WS on 2026-08-16.
 * Used as unit-test fixtures — tests must not call the network.
 */

type BinanceRestTickerRow = {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
};

/** REST /api/v3/ticker/24hr wire shape (prices as strings, closeTime as number). */
export const binanceRestFixture = [
  {
    symbol: 'BTCUSDT',
    priceChange: '26.97000000',
    priceChangePercent: '0.043',
    weightedAvgPrice: '63072.03771257',
    prevClosePrice: '63040.04000000',
    lastPrice: '63067.01000000',
    lastQty: '0.00408000',
    bidPrice: '63067.01000000',
    bidQty: '9.08654000',
    askPrice: '63067.02000000',
    askQty: '8.19743000',
    openPrice: '63040.04000000',
    highPrice: '63175.00000000',
    lowPrice: '62968.45000000',
    volume: '4360.18198000',
    quoteVolume: '275005562.27623740',
    openTime: 1_786_801_187_001,
    closeTime: 1_786_887_587_001,
    firstId: 6_575_568_835,
    lastId: 6_575_995_221,
    count: 426_387,
  },
  {
    symbol: 'ETHUSDT',
    priceChange: '-2.63000000',
    priceChangePercent: '-0.140',
    weightedAvgPrice: '1882.65486040',
    prevClosePrice: '1883.97000000',
    lastPrice: '1881.34000000',
    lastQty: '0.56750000',
    bidPrice: '1881.33000000',
    bidQty: '82.34040000',
    askPrice: '1881.34000000',
    askQty: '30.85440000',
    openPrice: '1883.97000000',
    highPrice: '1886.58000000',
    lowPrice: '1877.01000000',
    volume: '46714.76090000',
    quoteVolume: '87947771.66101500',
    openTime: 1_786_801_186_942,
    closeTime: 1_786_887_586_942,
    firstId: 4_269_333_364,
    lastId: 4_269_710_402,
    count: 377_039,
  },
  {
    symbol: 'XRPUSDT',
    priceChange: '-0.00210000',
    priceChangePercent: '-0.210',
    weightedAvgPrice: '1.00162774',
    prevClosePrice: '1.00230000',
    lastPrice: '1.00010000',
    lastQty: '118.30000000',
    bidPrice: '1.00010000',
    bidQty: '38348.00000000',
    askPrice: '1.00020000',
    askQty: '18687.00000000',
    openPrice: '1.00220000',
    highPrice: '1.00680000',
    lowPrice: '0.99720000',
    volume: '15966058.80000000',
    quoteVolume: '15992047.41559000',
    openTime: 1_786_801_185_143,
    closeTime: 1_786_887_585_143,
    firstId: 1_672_239_522,
    lastId: 1_672_314_386,
    count: 74_865,
  },
  {
    symbol: 'SOLUSDT',
    priceChange: '-0.17000000',
    priceChangePercent: '-0.225',
    weightedAvgPrice: '75.47397042',
    prevClosePrice: '75.57000000',
    lastPrice: '75.40000000',
    lastQty: '26.85600000',
    bidPrice: '75.39000000',
    bidQty: '636.26400000',
    askPrice: '75.40000000',
    askQty: '177.16000000',
    openPrice: '75.57000000',
    highPrice: '75.74000000',
    lowPrice: '75.17000000',
    volume: '521993.07600000',
    quoteVolume: '39396889.97713000',
    openTime: 1_786_801_186_773,
    closeTime: 1_786_887_586_773,
    firstId: 2_021_564_798,
    lastId: 2_021_690_638,
    count: 125_841,
  },
  {
    symbol: 'DOTUSDT',
    priceChange: '-0.01700000',
    priceChangePercent: '-2.185',
    weightedAvgPrice: '0.76435832',
    prevClosePrice: '0.77800000',
    lastPrice: '0.76100000',
    lastQty: '69.96000000',
    bidPrice: '0.76100000',
    bidQty: '44277.92000000',
    askPrice: '0.76200000',
    askQty: '9932.05000000',
    openPrice: '0.77800000',
    highPrice: '0.78100000',
    lowPrice: '0.75600000',
    volume: '2282948.23000000',
    quoteVolume: '1744990.47795000',
    openTime: 1_786_801_179_828,
    closeTime: 1_786_887_579_828,
    firstId: 443_953_227,
    lastId: 443_960_936,
    count: 7_710,
  },
  {
    symbol: 'DOGEUSDT',
    priceChange: '-0.00100000',
    priceChangePercent: '-0.990',
    weightedAvgPrice: '0.10050000',
    prevClosePrice: '0.10100000',
    lastPrice: '0.10000000',
    lastQty: '1000.00000000',
    bidPrice: '0.09990000',
    bidQty: '50000.00000000',
    askPrice: '0.10010000',
    askQty: '40000.00000000',
    openPrice: '0.10100000',
    highPrice: '0.10300000',
    lowPrice: '0.09800000',
    volume: '120000000.00000000',
    quoteVolume: '12000000.00000000',
    openTime: 1_786_801_179_828,
    closeTime: 1_786_887_579_828,
    firstId: 100_000_000,
    lastId: 100_050_000,
    count: 50_000,
  },
] as const satisfies readonly BinanceRestTickerRow[];

/** Combined-stream miniTicker wire shape captured live on 2026-08-16. */
export const binanceWsBtcFixture = {
  stream: 'btcusdt@miniTicker',
  data: {
    e: '24hrMiniTicker',
    E: 1_786_887_568_015,
    s: 'BTCUSDT',
    c: '63067.02000000',
    o: '63040.05000000',
    h: '63175.00000000',
    l: '62968.45000000',
    v: '4358.20655000',
    q: '274880973.21044400',
  },
} as const;

export const binanceWsEthFixture = {
  stream: 'ethusdt@miniTicker',
  data: {
    e: '24hrMiniTicker',
    E: 1_786_887_569_015,
    s: 'ETHUSDT',
    c: '1881.33000000',
    o: '1883.98000000',
    h: '1886.58000000',
    l: '1877.01000000',
    v: '46743.55840000',
    q: '88002035.99304400',
  },
} as const;

export const binanceWsSolFixture = {
  stream: 'solusdt@miniTicker',
  data: {
    e: '24hrMiniTicker',
    E: 1_786_887_569_797,
    s: 'SOLUSDT',
    c: '75.39000000',
    o: '75.57000000',
    h: '75.74000000',
    l: '75.17000000',
    v: '521996.53300000',
    q: '39397155.78386000',
  },
} as const;

export const binanceMalformedFixtures = {
  missingStream: {
    data: binanceWsBtcFixture.data,
  },
  wrongEventType: {
    stream: 'btcusdt@miniTicker',
    data: {
      ...binanceWsBtcFixture.data,
      e: 'trade',
    },
  },
  wrongPriceType: {
    stream: 'btcusdt@miniTicker',
    data: {
      ...binanceWsBtcFixture.data,
      c: 'not-a-number',
    },
  },
  unknownSymbol: {
    stream: 'adausdt@miniTicker',
    data: {
      ...binanceWsBtcFixture.data,
      s: 'ADAUSDT',
    },
  },
  negativePrice: {
    stream: 'btcusdt@miniTicker',
    data: {
      ...binanceWsBtcFixture.data,
      c: '-1.00',
    },
  },
  restWrongPriceType: {
    symbol: 'BTCUSDT',
    lastPrice: 'not-a-number',
    closeTime: 1_786_887_587_001,
  },
  restUnknownSymbol: {
    symbol: 'ADAUSDT',
    lastPrice: '0.10',
    closeTime: 1_786_887_587_001,
  },
};
