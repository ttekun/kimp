import { describe, expect, it } from 'vitest';

import { buildUpbitSubscribePayload } from '@kimchi/upbit-wire';

describe('buildUpbitSubscribePayload', () => {
  it('embeds the ticket without Node crypto', () => {
    const payload = buildUpbitSubscribePayload('ticket-1');
    const parsed = JSON.parse(payload) as unknown;
    expect(parsed).toEqual([
      { ticket: 'ticket-1' },
      {
        type: 'ticker',
        codes: ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'KRW-SOL', 'KRW-DOT', 'KRW-DOGE', 'KRW-USDT'],
      },
      { format: 'DEFAULT' },
    ]);
  });
});
