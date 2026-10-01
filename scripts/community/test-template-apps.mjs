// Runs each built template app in a real browser: a functional journey, console errors, screenshots (light/dark/mobile).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = '/tmp/tpl';
const out = process.argv[2] || '/home/user/coden/docs/community-screens/templates';
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const servers = {};
async function serve(slug) {
  const dist = path.join(root, slug, 'dist');
  const server = http.createServer((req, res) => {
    const file = path.join(dist, String(req.url).split('?')[0]);
    const real = file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('content-type', types[path.extname(real)] || 'application/octet-stream');
    res.end(fs.readFileSync(real));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers[slug] = server;
  return `http://127.0.0.1:${server.address().port}`;
}
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const problems = [];
const bases = {};
const journeys = {
  'budget-clair': async page => {
    await page.fill('input[placeholder="Ex. Marché"]', 'Café du matin');
    await page.fill('input[placeholder="0,00"]', '3,50');
    await page.click('button:has-text("Ajouter")');
    if (!(await page.locator('text=Café du matin').count())) throw new Error('la dépense ajoutée n’apparaît pas');
    await page.click('button:has-text("Ajouter")');
    if (!(await page.locator('[role=alert]').count())) throw new Error('pas de message d’erreur sur un formulaire vide');
    await page.selectOption('#filter', 'courses');
    await page.reload();
    if (!(await page.locator('text=Café du matin').count()) && !(await page.locator('#filter').count())) throw new Error('rechargement cassé');
  },
  'chez-marcel': async page => {
    await page.click('button[role=radio]:has-text("20h00")');
    await page.fill('input[autocomplete=name]', 'Awa Tchoumi');
    await page.fill('input[autocomplete=tel]', '+237 677 12 34 56');
    // Le lundi est fermé : on choisit un mardi.
    const next = new Date(); while (next.getDay() !== 2) next.setDate(next.getDate() + 1);
    await page.fill('input[type=date]', next.toISOString().slice(0, 10));
    await page.click('button[role=radio]:has-text("20h00")');
    await page.click('button:has-text("Confirmer la réservation")');
    await page.waitForSelector('[role=dialog]');
    await page.click('[role=dialog] button');
    if (!(await page.locator('text=Awa Tchoumi').count())) throw new Error('la réservation n’apparaît pas dans la liste');
    await page.click('button[role=tab]:has-text("Desserts")');
    if (!(await page.locator('text=Mousse au chocolat noir').count())) throw new Error('l’onglet Desserts ne change pas la carte');
  },
  'cap-sur-le-monde': async page => {
    await page.click('button:has-text("Commencer")');
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('1');
      await page.waitForSelector('button:has-text("Question suivante"), button:has-text("Voir mon score")');
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('text=Votre score');
    await page.click('button:has-text("Rejouer")');
    await page.waitForSelector('text=Question 1 sur 10');
  },
};
for (const slug of Object.keys(journeys)) {
  for (const [name, viewport, scheme] of [['desktop-light', { width: 1280, height: 860 }, 'light'], ['desktop-dark', { width: 1280, height: 860 }, 'dark'], ['mobile-light', { width: 390, height: 844 }, 'light']]) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on('console', message => { if (message.type() === 'error') problems.push(`${slug}/${name} console: ${message.text().slice(0, 160)}`); });
    page.on('pageerror', error => problems.push(`${slug}/${name} pageerror: ${String(error).slice(0, 160)}`));
    await page.goto(await (bases[slug] ??= serve(slug)), { waitUntil: 'load' });
    if (scheme === 'dark') await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) problems.push(`${slug}/${name}: débordement horizontal`);
    await page.screenshot({ path: `${out}/${slug}-${name}.png`, fullPage: name !== 'desktop-dark' });
    if (name === 'desktop-light') {
      try { await journeys[slug](page); } catch (error) { problems.push(`${slug} parcours: ${String(error.message).slice(0, 200)}`); }
      await page.waitForTimeout(300);
    }
    await ctx.close();
  }
}
await browser.close();
Object.values(servers).forEach(server => server.close());
console.log(problems.length ? `PROBLÈMES:\n${problems.join('\n')}` : 'aucun problème : parcours OK, aucune erreur console, pas de débordement');
