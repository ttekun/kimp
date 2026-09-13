import { afterEach, expect, it, vi } from 'vitest';
import { createUpbitBrowserClient } from './upbitBrowser';
import { createBinanceBrowserClient } from './binanceBrowser';

class MockSocket {
  static instances: MockSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = '';
  send = vi.fn();
  close = vi.fn();
  constructor() {
    MockSocket.instances.push(this);
  }
}
afterEach(() => {
  vi.useRealTimers();
  MockSocket.instances = [];
});

it.each([createUpbitBrowserClient, createBinanceBrowserClient])(
  'owns only one socket and reconnect timer per running client',
  (create) => {
    vi.useFakeTimers();
    const onMessage = vi.fn();
    const client = create(
      { onMessage, onConnectionChange: vi.fn() },
      MockSocket as unknown as typeof WebSocket,
    );
    client.start();
    client.start();
    expect(MockSocket.instances).toHaveLength(1);
    MockSocket.instances[0]!.onclose!();
    expect(vi.getTimerCount()).toBe(1);
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(MockSocket.instances).toHaveLength(1);
  },
);

it('ignores a decoded Upbit payload after stop and restart', async () => {
  const onMessage = vi.fn();
  const client = createUpbitBrowserClient(
    { onMessage, onConnectionChange: vi.fn() },
    MockSocket as unknown as typeof WebSocket,
  );
  client.start();
  MockSocket.instances[0]!.onmessage!({ data: '{"code":"KRW-BTC"}' } as MessageEvent);
  client.stop();
  client.start();
  await Promise.resolve();
  expect(onMessage).not.toHaveBeenCalled();
  MockSocket.instances[1]!.onmessage!({ data: '{"code":"KRW-ETH"}' } as MessageEvent);
  await Promise.resolve();
  expect(onMessage).toHaveBeenCalledWith({ code: 'KRW-ETH' });
  client.stop();
});
