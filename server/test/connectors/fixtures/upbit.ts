/**
 * Recorded from live Upbit REST on 2026-08-16 (docs/03 verified sample day).
 * Used as unit-test fixtures — tests must not call the network.
 */

type UpbitRestTickerRow = {
  market: string;
  trade_date: string;
  trade_time: string;
  trade_date_kst: string;
  trade_time_kst: string;
  trade_timestamp: number;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  prev_closing_price: number;
  change: string;
  change_price: number;
  change_rate: number;
  signed_change_price: number;
  signed_change_rate: number;
  trade_volume: number;
  acc_trade_price: number;
  acc_trade_price_24h: number;
  acc_trade_volume: number;
  acc_trade_volume_24h: number;
  highest_52_week_price: number;
  highest_52_week_date: string;
  lowest_52_week_price: number;
  lowest_52_week_date: string;
  timestamp: number;
};

/** REST ticker wire shape: market identifier is `market`. */
export const upbitRestFixture = [
  {
    market: 'KRW-BTC',
    trade_date: '20260816',
    trade_time: '130144',
    trade_date_kst: '20260816',
    trade_time_kst: '220144',
    trade_timestamp: 1786885304700,
    opening_price: 89266000,
    high_price: 89340000,
    low_price: 89099000,
    trade_price: 89167000,
    prev_closing_price: 89246000,
    change: 'FALL',
    change_price: 79000,
    change_rate: 0.0008851937,
    signed_change_price: -79000,
    signed_change_rate: -0.0008851937,
    trade_volume: 0.00005607,
    acc_trade_price: 9318129609.3013,
    acc_trade_price_24h: 14828736024.7666,
    acc_trade_volume: 104.43574431,
    acc_trade_volume_24h: 166.21200809,
    highest_52_week_price: 179869000,
    highest_52_week_date: '2025-10-09',
    lowest_52_week_price: 88342000,
    lowest_52_week_date: '2026-08-14',
    timestamp: 1786885305230,
  },
  {
    market: 'KRW-ETH',
    trade_date: '20260816',
    trade_time: '130137',
    trade_date_kst: '20260816',
    trade_time_kst: '220137',
    trade_timestamp: 1786885297727,
    opening_price: 2662000,
    high_price: 2667000,
    low_price: 2657000,
    trade_price: 2660000,
    prev_closing_price: 2662000,
    change: 'FALL',
    change_price: 2000,
    change_rate: 0.0007513148,
    signed_change_price: -2000,
    signed_change_rate: -0.0007513148,
    trade_volume: 0.1041205,
    acc_trade_price: 5092240699.26316,
    acc_trade_price_24h: 8226297605.56365,
    acc_trade_volume: 1913.15274212,
    acc_trade_volume_24h: 3089.67615358,
    highest_52_week_price: 6845000,
    highest_52_week_date: '2025-08-24',
    lowest_52_week_price: 2300000,
    lowest_52_week_date: '2026-06-06',
    timestamp: 1786885304902,
  },
  {
    market: 'KRW-XRP',
    trade_date: '20260816',
    trade_time: '130140',
    trade_date_kst: '20260816',
    trade_time_kst: '220140',
    trade_timestamp: 1786885300489,
    opening_price: 1418,
    high_price: 1420,
    low_price: 1413,
    trade_price: 1416,
    prev_closing_price: 1418,
    change: 'FALL',
    change_price: 2,
    change_rate: 0.0014104372,
    signed_change_price: -2,
    signed_change_rate: -0.0014104372,
    trade_volume: 53.57680084,
    acc_trade_price: 8738092109.530909,
    acc_trade_price_24h: 12909849744.654255,
    acc_trade_volume: 6169234.03599903,
    acc_trade_volume_24h: 9110794.39143215,
    highest_52_week_price: 4412,
    highest_52_week_date: '2025-09-13',
    lowest_52_week_price: 1397,
    lowest_52_week_date: '2026-08-11',
    timestamp: 1786885304585,
  },
  {
    market: 'KRW-SOL',
    trade_date: '20260816',
    trade_time: '130101',
    trade_date_kst: '20260816',
    trade_time_kst: '220101',
    trade_timestamp: 1786885261057,
    opening_price: 106600,
    high_price: 107000,
    low_price: 106300,
    trade_price: 106500,
    prev_closing_price: 106600,
    change: 'FALL',
    change_price: 100,
    change_rate: 0.0009380863,
    signed_change_price: -100,
    signed_change_rate: -0.0009380863,
    trade_volume: 0.09398496,
    acc_trade_price: 1453485081.139614,
    acc_trade_price_24h: 2319043282.508989,
    acc_trade_volume: 13624.97335681,
    acc_trade_volume_24h: 21728.68723259,
    highest_52_week_price: 350800,
    highest_52_week_date: '2025-09-18',
    lowest_52_week_price: 91800,
    lowest_52_week_date: '2026-06-06',
    timestamp: 1786885299496,
  },
  {
    market: 'KRW-DOT',
    trade_date: '20260816',
    trade_time: '123716',
    trade_date_kst: '20260816',
    trade_time_kst: '213716',
    trade_timestamp: 1786883836568,
    opening_price: 1077,
    high_price: 1080,
    low_price: 1070,
    trade_price: 1079,
    prev_closing_price: 1077,
    change: 'RISE',
    change_price: 2,
    change_rate: 0.0018570102,
    signed_change_price: 2,
    signed_change_rate: 0.0018570102,
    trade_volume: 934.22190208,
    acc_trade_price: 90205745.8093237,
    acc_trade_price_24h: 193947060.76277012,
    acc_trade_volume: 83983.01314063,
    acc_trade_volume_24h: 179772.90003457,
    highest_52_week_price: 6790,
    highest_52_week_date: '2025-09-19',
    lowest_52_week_price: 1063,
    lowest_52_week_date: '2026-08-14',
    timestamp: 1786885121808,
  },
  {
    market: 'KRW-DOGE',
    trade_date: '20260816',
    trade_time: '123716',
    trade_date_kst: '20260816',
    trade_time_kst: '213716',
    trade_timestamp: 1786883836568,
    opening_price: 140,
    high_price: 142,
    low_price: 138,
    trade_price: 140,
    prev_closing_price: 141,
    change: 'FALL',
    change_price: 1,
    change_rate: 0.0070921985,
    signed_change_price: -1,
    signed_change_rate: -0.0070921985,
    trade_volume: 5000,
    acc_trade_price: 120000000,
    acc_trade_price_24h: 3500000000,
    acc_trade_volume: 850000,
    acc_trade_volume_24h: 25000000,
    highest_52_week_price: 350,
    highest_52_week_date: '2025-11-20',
    lowest_52_week_price: 90,
    lowest_52_week_date: '2026-06-06',
    timestamp: 1786885121808,
  },
  {
    market: 'KRW-USDT',
    trade_date: '20260816',
    trade_time: '130146',
    trade_date_kst: '20260816',
    trade_time_kst: '220146',
    trade_timestamp: 1786885306159,
    opening_price: 1415,
    high_price: 1416,
    low_price: 1414,
    trade_price: 1415,
    prev_closing_price: 1415,
    change: 'EVEN',
    change_price: 0,
    change_rate: 0,
    signed_change_price: 0,
    signed_change_rate: 0,
    trade_volume: 55.61427561,
    acc_trade_price: 23795265836.606567,
    acc_trade_price_24h: 40942606250.263115,
    acc_trade_volume: 16811338.65790678,
    acc_trade_volume_24h: 28934949.6187165,
    highest_52_week_price: 1655,
    highest_52_week_date: '2025-10-10',
    lowest_52_week_price: 1374,
    lowest_52_week_date: '2025-08-23',
    timestamp: 1786885306497,
  },
] as const satisfies readonly UpbitRestTickerRow[];

/** WS ticker wire shape: market identifier is `code` (no `market` field on live WS). */
export function buildUpbitWsTickerFixture(restRow: UpbitRestTickerRow): {
  type: 'ticker';
  code: string;
  trade_date: string;
  trade_time: string;
  trade_date_kst: string;
  trade_time_kst: string;
  trade_timestamp: number;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  prev_closing_price: number;
  change: string;
  change_price: number;
  change_rate: number;
  signed_change_price: number;
  signed_change_rate: number;
  trade_volume: number;
  acc_trade_price: number;
  acc_trade_price_24h: number;
  acc_trade_volume: number;
  acc_trade_volume_24h: number;
  highest_52_week_price: number;
  highest_52_week_date: string;
  lowest_52_week_price: number;
  lowest_52_week_date: string;
  timestamp: number;
} {
  const { market, ...fields } = restRow;
  return {
    type: 'ticker',
    code: market,
    ...fields,
  };
}

export const upbitWsBtcFixture = buildUpbitWsTickerFixture(upbitRestFixture[0]);
export const upbitWsUsdtFixture = buildUpbitWsTickerFixture(
  upbitRestFixture.find((row) => row.market === 'KRW-USDT')!,
);

export const upbitMalformedFixtures = {
  missingMarketOrCode: {
    trade_price: 1,
    signed_change_rate: 0,
    acc_trade_price_24h: 0,
    timestamp: 1,
  },
  wrongTypePrice: {
    market: 'KRW-BTC',
    trade_price: 'not-a-number',
    signed_change_rate: 0,
    acc_trade_price_24h: 0,
    timestamp: 1,
  },
  unknownMarket: {
    market: 'KRW-ADA',
    trade_price: 100,
    signed_change_rate: 0.01,
    acc_trade_price_24h: 1000,
    timestamp: 1_700_000_000_000,
    trade_date: '20260816',
  },
  unknownWsCode: {
    type: 'ticker',
    code: 'KRW-ADA',
    trade_price: 100,
    signed_change_rate: 0.01,
    acc_trade_price_24h: 1000,
    timestamp: 1_700_000_000_000,
    trade_date: '20260816',
  },
  negativeVolume24h: {
    type: 'ticker',
    code: 'KRW-BTC',
    trade_price: 89_167_000,
    signed_change_rate: -0.0008851937,
    acc_trade_price_24h: -1,
    timestamp: 1_786_885_305_230,
    trade_date: '20260816',
  },
};
