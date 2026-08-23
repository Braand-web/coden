const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const routePolicy = JSON.parse(fs.readFileSync(path.join(root, 'config', 'public-route-policy.json'), 'utf8'));
const routeToFile = route => route === '/' ? 'index.html' : route.replace(/^\//, '');
const publicPages = routePolicy.canonicalPublic.map(routeToFile);
const privatePages = routePolicy.private.map(routeToFile);
const failures = [];

function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    failures.push(`${file}: file is missing`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}

function assert(file, condition, message) {
  if (!condition) failures.push(`${file}: ${message}`);
}

for (const file of publicPages) {
  const html = read(file);
  if (!html) continue;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || '';
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || '';
  const robots = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i)?.[1] || '';
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  assert(file, title.length >= 10 && title.length <= 70, `title must be 10–70 characters (got ${title.length})`);
  assert(file, description.length >= 50 && description.length <= 170, `description must be 50–170 characters (got ${description.length})`);
  assert(file, /^https:\/\/coden\.fun\//.test(canonical), 'canonical must use https://coden.fun/');
  assert(file, /index\s*,\s*follow/i.test(robots), 'public page must be indexable');
  assert(file, h1Count === 1, `expected exactly one h1 (got ${h1Count})`);
  assert(file, /property=["']og:image["']/i.test(html), 'missing og:image');
  assert(file, /data-coden-logo|coden-logo-mark|M16 8L25 13\.5/i.test(html), 'visible Coden logo icon is missing');
}

for (const file of privatePages) {
  const html = read(file);
  if (!html) continue;
  const robots = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i)?.[1] || '';
  assert(file, /noindex\s*,\s*nofollow/i.test(robots), 'private page must be noindex,nofollow');
}

const robots = read('public/robots.txt');
assert('public/robots.txt', /Sitemap:\s*https:\/\/coden\.fun\/sitemap\.xml/i.test(robots), 'sitemap URL is missing');
const sitemap = read('public/sitemap.xml');
assert('public/sitemap.xml', /<urlset[\s>]/i.test(sitemap), 'invalid sitemap root');
assert('public/sitemap.xml', !/<loc>https:\/\/coden\.fun\/(auth|dashboard|builder|checkout|admin)\.html<\/loc>/i.test(sitemap), 'private page must not be in sitemap');
for (const route of routePolicy.canonicalPublic) {
  assert('public/sitemap.xml', sitemap.includes(`<loc>https://coden.fun${route}</loc>`), `canonical route ${route} is missing from sitemap`);
}
for (const route of Object.keys(routePolicy.redirects)) {
  const target = routePolicy.redirects[route];
  const expected = `${route} ${target} 301`;
  const redirects = read('public/_redirects');
  assert('public/_redirects', redirects.split(/\r?\n/).includes(expected), `missing permanent redirect ${expected}`);
  assert('public/sitemap.xml', !sitemap.includes(`<loc>https://coden.fun${route}</loc>`), `removed route ${route} must not be in sitemap`);

  // Redirect-only pages must not remain as build inputs. The dynamic
  // /built-with-coden/:projectId server route is intentionally not a file.
  if (!route.includes(':')) {
    const sourceFile = route.endsWith('/')
      ? path.join(root, route.slice(1), 'index.html')
      : path.join(root, route.slice(1));
    assert(route, !fs.existsSync(sourceFile), 'redirect-only source file must be removed');
  }
}

for (const file of [...publicPages, ...privatePages]) {
  const html = read(file);
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || /^https?:\/\//i.test(href)) continue;
    const route = (href.split(/[?#]/)[0] || '/').replace(/\\/g, '/');
    if (routePolicy.redirects[route]) {
      failures.push(`${file}: navigation points to removed route ${route}; use ${routePolicy.redirects[route]}`);
    }
  }
}

const shells = read('src/components/shells.tsx');
assert('src/components/shells.tsx', /CodenBrand/.test(shells), 'React marketing shell must use the canonical Coden logo');
assert('src/components/shells.tsx', !/coden-react-brand-mark[^\n]*>H</.test(shells), 'React marketing shell must not render a text-only H brand mark');

for (const file of publicPages) {
  const html = read(file);
  assert(file, /coden-marketing-header-root/.test(html), 'public page must expose the canonical marketing header mount');
  assert(file, !/marketing-prompt-section|page-proof-grid|seo-panel|Start from a prompt/i.test(html), 'generic injected marketing block must not remain on a canonical page');
}

if (failures.length) {
  console.error(`SEO check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`SEO check passed for ${publicPages.length} public pages and ${privatePages.length} private pages.`);
