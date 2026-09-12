import { expect, test } from '@playwright/test';

import { e2eSnapshot } from './fixture';
import { openMockedApp } from './mockMarket';

test.describe('Task 6.1 mocked market E2E', () => {
  test('loads table data from the mocked snapshot / WS', async ({ page }) => {
    await openMockedApp(page, e2eSnapshot());

    const coins = page.locator('[data-pair="binance"] tbody th[scope="row"]');
    await expect(coins).toHaveText(['XRP', 'ETH', 'DOGE', 'BTC', 'SOL', 'DOT']);
    await expect(page.getByLabel('BTC Binance premium')).toContainText('-0.50%');
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('toggles Premium sort to ascending on click', async ({ page }) => {
    await openMockedApp(page, e2eSnapshot());

    await page
      .locator('[data-pair="binance"] button.premium-table__sort')
      .filter({
        hasText: 'Premium',
      })
      .click();

    const coins = page.locator('[data-pair="binance"] tbody th[scope="row"]');
    await expect(coins).toHaveText(['SOL', 'BTC', 'DOGE', 'ETH', 'XRP', 'DOT']);
  });

  test('theme toggle persists across reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openMockedApp(page, e2eSnapshot());

    const toggle = page.getByRole('switch', { name: 'Dark mode' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await page.locator('[data-pair="binance"] tbody th[scope="row"]').first().waitFor();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('table scrolls horizontally at 320px without overflowing the page', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openMockedApp(page, e2eSnapshot());

    const scroller = page.locator('[data-pair="binance"] .premium-table__scroll');

    const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);

    // Every column stays reachable by scrolling rather than being display:none.
    await expect(
      page.locator('[data-pair="binance"] tbody td[data-col="volume"]').first(),
    ).toHaveCount(1);

    await scroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

    const documentOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(documentOverflow).toBeLessThanOrEqual(0);
  });

  test('shows reconnect banner after the mocked socket drops', async ({ page }) => {
    const market = await openMockedApp(page, e2eSnapshot());
    await expect(page.getByLabel('BTC Binance premium')).toBeVisible();

    await market.closeSockets();

    await expect(page.getByRole('status')).toHaveText('Reconnecting to the market feed…');

    await market.allowReconnect();
    await expect(page.getByRole('status')).toHaveCount(0);
  });
});
