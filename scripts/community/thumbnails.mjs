// Takes the 16/10 WebP thumbnail of each template app from its built page (light theme, top of the page).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const out = '/home/user/coden/public/community-templates';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const slug of ['budget-clair', 'chez-marcel', 'cap-sur-le-monde']) {
  const dist = `/tmp/tpl/${slug}/dist`;
  const server = http.createServer((req, res) => {
    const file = path.join(dist, String(req.url).split('?')[0]);
    const real = file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(real)] || 'application/octet-stream');
    res.end(fs.readFileSync(real));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })).newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const shot = await page.screenshot({ type: 'jpeg', quality: 86 });
  await sharp(shot).resize({ width: 800, height: 500, fit: 'cover', position: 'top' }).webp({ quality: 80 }).toFile(`${out}/${slug}.webp`);
  server.close();
}
await browser.close();
console.log(fs.readdirSync(out).map(f => `${f} ${fs.statSync(path.join(out, f)).size}`).join('\n'));
