import { describe, expect, it } from 'vitest';

import {
  BINANCE_MARKET_CODES,
  BITBANK_MARKET_CODES,
  COIN_SYMBOLS,
  EXCHANGE_MARKET_CODES,
  TARGET_EXCHANGES,
  UPBIT_MARKET_CODES,
  type CoinSymbol,
  type TargetExchange,
} from '../../src/core/symbols.js';

const EXPECTED_COINS = [
  'BTC',
  'ETH',
  'XRP',
  'SOL',
  'DOT',
  'DOGE',
] as const satisfies readonly CoinSymbol[];

const EXPECTED_UPBIT_CODES: Record<CoinSymbol, string> = {
  BTC: 'KRW-BTC',
  ETH: 'KRW-ETH',
  XRP: 'KRW-XRP',
  SOL: 'KRW-SOL',
  DOT: 'KRW-DOT',
  DOGE: 'KRW-DOGE',
};

const EXPECTED_BINANCE_CODES: Record<CoinSymbol, string> = {
  BTC: 'btcusdt',
  ETH: 'ethusdt',
  XRP: 'xrpusdt',
  SOL: 'solusdt',
  DOT: 'dotusdt',
  DOGE: 'dogeusdt',
};

const EXPECTED_BITBANK_CODES: Record<CoinSymbol, string> = {
  BTC: 'btc_jpy',
  ETH: 'eth_jpy',
  XRP: 'xrp_jpy',
  SOL: 'sol_jpy',
  DOT: 'dot_jpy',
  DOGE: 'doge_jpy',
};

const EXPECTED_TARGET_EXCHANGES = [
  'binance',
  'bitbank',
] as const satisfies readonly TargetExchange[];

describe('symbols scope guard', () => {
  it('locks the coin universe to the documented symbols', () => {
    expect(COIN_SYMBOLS).toHaveLength(EXPECTED_COINS.length);
    expect([...COIN_SYMBOLS]).toEqual([...EXPECTED_COINS]);
  });

  it('locks target exchanges to exactly Binance and Bitbank', () => {
    expect(TARGET_EXCHANGES).toHaveLength(2);
    expect([...TARGET_EXCHANGES]).toEqual([...EXPECTED_TARGET_EXCHANGES]);
  });

  it('maps each coin to exactly one Upbit market code and no extras', () => {
    expect(Object.keys(UPBIT_MARKET_CODES).sort()).toEqual([...EXPECTED_COINS].sort());
    expect(UPBIT_MARKET_CODES).toEqual(EXPECTED_UPBIT_CODES);
  });

  it('maps each target exchange to one market code per coin and no extras', () => {
    expect(Object.keys(EXCHANGE_MARKET_CODES).sort()).toEqual(
      [...EXPECTED_TARGET_EXCHANGES].sort(),
    );

    for (const exchange of TARGET_EXCHANGES) {
      const codes = EXCHANGE_MARKET_CODES[exchange];
      expect(Object.keys(codes).sort()).toEqual([...EXPECTED_COINS].sort());
    }

    expect(BINANCE_MARKET_CODES).toEqual(EXPECTED_BINANCE_CODES);
    expect(BITBANK_MARKET_CODES).toEqual(EXPECTED_BITBANK_CODES);
  });
});
