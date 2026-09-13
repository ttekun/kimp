import { expect, it, vi } from 'vitest';
import { UpbitConnector } from '../../src/connectors/upbit.js';
import { BinanceConnector } from '../../src/connectors/binance.js';
import { FxPoller } from '../../src/connectors/fx.js';
import { upbitRestFixture } from './fixtures/upbit.js';
import { binanceRestFixture } from './fixtures/binance.js';
import { erApiFixture } from './fixtures/fx.js';

it.each(['upbit', 'binance', 'fx'] as const)(
  'ignores pending %s responses after stop',
  async (kind) => {
    let resolve!: (value: Response) => void;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const callback = vi.fn();
    const connector =
      kind === 'upbit'
        ? new UpbitConnector({ fetchFn, onTicker: callback, onUsdtRate: callback })
        : kind === 'binance'
          ? new BinanceConnector({ fetchFn, onTicker: callback })
          : new FxPoller({ fetchFn, onRates: callback });
    const started = connector.start();
    connector.stop();
    const payload =
      kind === 'upbit' ? upbitRestFixture : kind === 'binance' ? binanceRestFixture : erApiFixture;
    resolve(new Response(JSON.stringify(payload)));
    await started;
    expect(callback).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  },
);
