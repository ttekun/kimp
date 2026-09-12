import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { E2E_NOW, e2eSnapshot } from './fixture';
import { openMockedApp } from './mockMarket';

test.describe('Task 6.3 accessibility and motion', () => {
  test('axe has no serious or critical violations on both themes', async ({ page }) => {
    await openMockedApp(page, e2eSnapshot());

    const light = await new AxeBuilder({ page }).analyze();
    expect(
      light.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);

    await page.getByRole('switch', { name: 'Dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const dark = await new AxeBuilder({ page }).analyze();
    expect(
      dark.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    ).toEqual([]);
  });

  test('keyboard: coin switcher, sort header, theme switch', async ({ page }) => {
    await openMockedApp(page, e2eSnapshot());

    await page.getByRole('radio', { name: 'BTC' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'ETH' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('ETH featured premium')).toBeVisible();

    await page
      .locator('[data-pair="binance"] button.premium-table__sort')
      .filter({
        hasText: 'Premium',
      })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-pair="binance"] tbody th[scope="row"]').first()).toHaveText(
      'SOL',
    );

    const toggle = page.getByRole('switch', { name: 'Dark mode' });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('value-change flash runs unless prefers-reduced-motion', async ({ page }) => {
    const market = await openMockedApp(page, e2eSnapshot());

    const bumped = e2eSnapshot(E2E_NOW + 1000);
    bumped.coins.BTC.upbit = { ...bumped.coins.BTC.upbit!, price: 101_000_000 };
    await market.pushSnapshot(bumped);

    const flashRow = page.locator(
      '[data-pair="binance"] tbody tr.premium-table__row:has(th[scope="row"]:text-is("BTC"))',
    );
    await expect(flashRow).toHaveAttribute('data-flash', 'up');
    const upbitCell = flashRow.locator('td[data-col="upbit"]');
    await expect
      .poll(async () => upbitCell.evaluate((el) => getComputedStyle(el).animationName))
      .toMatch(/premium-flash/);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const bumpedAgain = e2eSnapshot(E2E_NOW + 2000);
    bumpedAgain.coins.BTC.upbit = { ...bumpedAgain.coins.BTC.upbit!, price: 102_000_000 };
    await market.pushSnapshot(bumpedAgain);

    await expect
      .poll(async () => upbitCell.evaluate((el) => getComputedStyle(el).animationName))
      .toBe('none');
  });
});
