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
  // The brand lives in the mounted header, not in the <noscript> fallback:
  // with scripting on, a browser parses noscript content as text, so nothing
  // inside it is ever a queryable element.
  await expect(page.locator('[data-coden-logo="brand"]').first()).toBeVisible();
  await expect(page.locator('.hero-flow-rail')).toHaveCount(0);
  await expect(page.locator('.import-row')).toHaveCount(0);
  // The composer is the hero's point. It has to be reachable and typable.
  await expect(page.locator('#ai-textarea')).toBeVisible();
  await expect(page.locator('#submit-btn')).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'smooth');

  // Every section shares one measure, so their content columns line up rather
  // than each block finding its own width. A missing selector fails loudly
  // instead of scoring as centred.
  const offsets = await page.evaluate(() => {
    const center = document.documentElement.clientWidth / 2;
    return ['.cdn-hero__inner', '.cdn-section .cdn-wrap', '.cdn-closing__inner'].map(selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? Math.abs(rect.left + rect.width / 2 - center) : Number.POSITIVE_INFINITY;
    });
  });
  expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
});

test('canonical public pages do not expose horizontal overflow', async ({ page }) => {
  for (const route of ['/features.html', '/pricing.html', '/documentation.html']) {
    await page.goto(route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route} should not overflow horizontally`).toBeLessThanOrEqual(1);
  }
});
