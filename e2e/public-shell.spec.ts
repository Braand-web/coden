import { expect, test } from '@playwright/test';

test('landing keeps one clear primary heading and the Coden brand', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    // Vite preview intentionally serves only the production frontend bundle;
    // API contracts are covered by the server integration suite.
    if (response.status() >= 400 && !url.pathname.startsWith('/api/')) {
      runtimeErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto('/');
  await page.waitForTimeout(250);
  expect(runtimeErrors).toEqual([]);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Coden home', exact: true })).toBeVisible();
  await expect(page.locator('#top textarea')).toBeVisible();
  await expect(page.locator('.hero-flow-rail')).toHaveCount(0);
  await expect(page.locator('.import-row')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'smooth');

  const layout = await page.evaluate(() => {
    const viewportCenter = document.documentElement.clientWidth / 2;
    return ['#top h1', '#top .input-wrapper', '#faq'].map(selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? Math.abs(rect.left + rect.width / 2 - viewportCenter) : Number.POSITIVE_INFINITY;
    });
  });
  expect(Math.max(...layout)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const question = page.locator('#faq summary').filter({ hasText: 'Can I connect my own database or Stripe account?' });
  await question.click();
  await expect(page.locator('#faq details').filter({ hasText: 'Can I connect my own database' })).toHaveAttribute('open', '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
});

test('canonical public pages do not expose horizontal overflow', async ({ page }) => {
  for (const route of ['/features.html', '/pricing.html', '/documentation.html']) {
    await page.goto(route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route} should not overflow horizontally`).toBeLessThanOrEqual(1);
  }
});
