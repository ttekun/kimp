import { expect, test } from '@playwright/test';

import { e2eSnapshot } from './fixture';
import { openMockedApp } from './mockMarket';

const VIEWPORTS = [
  { name: '320', width: 320, height: 900 },
  { name: '768', width: 768, height: 900 },
  { name: '1024', width: 1024, height: 900 },
  { name: '1440', width: 1440, height: 900 },
] as const;

const THEMES = ['light', 'dark'] as const;

test.describe('Task 6.2 visual regression', () => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${theme} ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        await openMockedApp(page, e2eSnapshot());
        await page.addStyleTag({
          content:
            'html, body, button, input { font-family: Arial, Helvetica, sans-serif !important; }',
        });
        await expect(page.locator('[data-pair="binance"] tbody')).toBeVisible();
        await expect(page).toHaveScreenshot(`${theme}-${viewport.name}.png`, {
          fullPage: true,
          animations: 'disabled',
        });
      });
    }
  }
});
