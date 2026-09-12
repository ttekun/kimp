import { expect, test } from '@playwright/test';

test.describe('GitHub Pages subpath smoke', () => {
  test('serves index and theme-boot.js under /kimp/', async ({ page, request }) => {
    const boot = await request.get('/kimp/theme-boot.js');
    expect(boot.ok()).toBeTruthy();
    expect(boot.headers()['content-type'] ?? '').toMatch(/javascript|ecmascript/i);

    const index = await request.get('/kimp/');
    expect(index.ok()).toBeTruthy();
    const html = await index.text();
    expect(html).toContain('/kimp/theme-boot.js');
    expect(html).toContain("connect-src 'self'");

    await page.goto('/kimp/');
    await expect(page.locator('#root')).toBeVisible();
  });
});
