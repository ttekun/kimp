import { expect, test } from '@playwright/test';

test.describe('GitHub Pages subpath smoke', () => {
  test('serves index and theme-boot.js under /kimchi-premium-clone/', async ({ page, request }) => {
    const boot = await request.get('/kimchi-premium-clone/theme-boot.js');
    expect(boot.ok()).toBeTruthy();
    expect(boot.headers()['content-type'] ?? '').toMatch(/javascript|ecmascript/i);

    const index = await request.get('/kimchi-premium-clone/');
    expect(index.ok()).toBeTruthy();
    const html = await index.text();
    expect(html).toContain('/kimchi-premium-clone/theme-boot.js');
    expect(html).toContain("connect-src 'self'");

    await page.goto('/kimchi-premium-clone/');
    await expect(page.locator('#root')).toBeVisible();
  });
});
