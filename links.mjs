import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
for (const url of ['/pricing.html', '/', '/features.html', '/documentation.html', '/security.html']) {
  await page.goto('http://127.0.0.1:4190' + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const links = await page.evaluate(() => [...document.querySelectorAll('a,button')]
    .filter(el => /tarif|pricing|back|retour/i.test(el.textContent || '') || /pricing|tarif/i.test(el.getAttribute('href') || ''))
    .map(el => ({ tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 30), href: el.getAttribute('href'), cls: (el.className || '').toString().slice(0, 45) })));
  console.log('\n===', url, '===');
  for (const l of links) console.log(' ', JSON.stringify(l));
}
await browser.close();
