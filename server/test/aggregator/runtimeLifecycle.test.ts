import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  listen: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
}));
vi.mock('../../src/connectors/upbit.js', () => ({
  UpbitConnector: class {
    start = mocks.start;
    stop = mocks.stop;
  },
}));
vi.mock('../../src/connectors/binance.js', () => ({
  BinanceConnector: class {
    start = mocks.start;
    stop = mocks.stop;
  },
}));
vi.mock('../../src/connectors/bitbank.js', () => ({
  BitbankConnector: class {
    start = mocks.start;
    stop = mocks.stop;
  },
}));
vi.mock('../../src/connectors/fx.js', () => ({
  FxPoller: class {
    start = mocks.start;
    stop = mocks.stop;
  },
}));
vi.mock('../../src/transport/httpApi.js', () => ({
  buildHttpApi: vi.fn(async () => ({ listen: mocks.listen, close: mocks.close })),
}));
import { createAggregatorRuntime } from '../../src/aggregator/runtime.js';
beforeEach(() => vi.clearAllMocks());
it('stops every connector and closes HTTP when listening fails', async () => {
  mocks.listen.mockRejectedValueOnce(new Error('address in use'));
  await expect(createAggregatorRuntime({ port: 3000 })).rejects.toThrow('address in use');
  expect(mocks.stop).toHaveBeenCalledTimes(4);
  expect(mocks.close).toHaveBeenCalledTimes(1);
});
it('stops all connectors if any startup fails', async () => {
  mocks.start.mockRejectedValueOnce(new Error('startup failed'));
  await expect(createAggregatorRuntime({ port: 3000 })).rejects.toThrow('startup failed');
  expect(mocks.stop).toHaveBeenCalledTimes(4);
});
