import { expect, type Page } from '@playwright/test';

import type { MarketSnapshot } from '../src/lib/types';
import type { ConnectionStatus } from '../src/store/marketStore';

export interface MockMarketControl {
  setSnapshot: (snapshot: MarketSnapshot) => Promise<void>;
  setConnectionStatus: (status: ConnectionStatus) => Promise<void>;
  closeSockets: () => Promise<void>;
  allowReconnect: () => Promise<void>;
  pushSnapshot: (snapshot: MarketSnapshot) => Promise<void>;
}

export async function openMockedApp(
  page: Page,
  snapshot: MarketSnapshot,
): Promise<MockMarketControl> {
  await page.addInitScript((pending) => {
    window.__KIMP_E2E_DISABLE_LIVE__ = true;
    window.__KIMP_E2E_PENDING_SNAPSHOT__ = pending;
  }, snapshot);

  await page.goto('/');
  await page.waitForFunction(() => window.__KIMP_E2E__ !== undefined);

  await page.evaluate((next) => {
    window.__KIMP_E2E__!.setSnapshot(next);
    window.__KIMP_E2E__!.setConnectionStatus('live');
  }, snapshot);

  await page.locator('[data-pair="binance"] tbody th[scope="row"]').first().waitFor();
  await expect(page.locator('.fx-bar__transport')).toHaveAttribute('data-status', 'live');

  return {
    setSnapshot: async (next) => {
      await page.evaluate((payload) => {
        window.__KIMP_E2E__!.setSnapshot(payload);
      }, next);
    },
    setConnectionStatus: async (status) => {
      await page.evaluate((value) => {
        window.__KIMP_E2E__!.setConnectionStatus(value);
      }, status);
    },
    closeSockets: async () => {
      await page.evaluate(() => {
        window.__KIMP_E2E__!.setConnectionStatus('reconnecting');
      });
    },
    allowReconnect: async () => {
      await page.evaluate(() => {
        window.__KIMP_E2E__!.setConnectionStatus('live');
      });
    },
    pushSnapshot: async (next) => {
      await page.evaluate((payload) => {
        window.__KIMP_E2E__!.setSnapshot(payload);
      }, next);
    },
  };
}
