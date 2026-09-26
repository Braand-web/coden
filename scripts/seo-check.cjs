const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const origin = 'https://coden.fun';
const policy = JSON.parse(fs.readFileSync(path.join(root, 'config', 'public-route-policy.json'), 'utf8'));
const routeToFile = route => route === '/' ? 'index.html' : route.replace(/^\//, '');
const publicPages = policy.canonicalPublic.map(routeToFile);
const privatePages = policy.private.map(routeToFile);
const failures = [];

function read(file) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    failures.push(`${file}: fichier manquant`);
    return '';
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function assert(file, condition, message) {
  if (!condition) failures.push(`${file}: ${message}`);
}

function tags(html, tagName) {
  return Array.from(html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')), match => match[0]);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] || '';
}

function oneMeta(html, file, key, value) {
  const matches = tags(html, 'meta').filter(tag => attribute(tag, key).toLowerCase() === value.toLowerCase());
  assert(file, matches.length === 1, `attendu exactement un meta ${key}=${value} (trouvé ${matches.length})`);
  return matches[0] ? attribute(matches[0], 'content') : '';
}

function validateLanguageAndTitle(html, file) {
  const lang = html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1] || '';
  const titles = Array.from(html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi), match => match[1].trim());
  assert(file, lang.toLowerCase() === 'fr', 'la langue du document doit être déclarée en français');
  assert(file, titles.length === 1, `attendu un seul title (trouvé ${titles.length})`);
  assert(file, titles[0]?.length >= 10 && titles[0]?.length <= 70, `title doit faire 10–70 caractères (reçu ${titles[0]?.length || 0})`);
  return titles[0] || '';
}

function structuredData(html, file, canonical, isHome) {
  const scripts = Array.from(html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  assert(file, scripts.length === 1, `attendu un bloc JSON-LD (trouvé ${scripts.length})`);
  if (scripts.length !== 1) return;
  let data;
  try {
    data = JSON.parse(scripts[0][1]);
  } catch {
    assert(file, false, 'JSON-LD invalide');
    return;
  }
  const graph = data['@graph'] || [];
  const types = graph.map(item => item['@type']);
  assert(file, data['@context'] === 'https://schema.org', 'contexte Schema.org manquant');
  assert(file, types.includes('Organization') && types.includes('WebSite') && types.includes('WebPage'), 'le graphe doit décrire Organization, WebSite et WebPage');
  assert(file, graph.some(item => item['@type'] === 'WebPage' && item.url === canonical), 'WebPage JSON-LD doit correspondre au canonical');
  assert(file, isHome ? !types.includes('BreadcrumbList') : types.includes('BreadcrumbList'), 'BreadcrumbList incohérent avec la page');
  assert(file, !types.some(type => ['FAQPage', 'Product', 'SoftwareApplication'].includes(type)), 'ne pas émettre de rich results non justifiés (FAQ, Product ou SoftwareApplication)');
}

const publicTitles = new Map();
for (const file of publicPages) {
  const html = read(file);
  if (!html) continue;
  const route = file === 'index.html' ? '/' : `/${file}`;
  const canonical = `${origin}${route}`;
  const title = validateLanguageAndTitle(html, file);
  assert(file, !publicTitles.has(title), `title identique à ${publicTitles.get(title) || ''}`);
  publicTitles.set(title, file);
  const description = oneMeta(html, file, 'name', 'description');
  const robots = oneMeta(html, file, 'name', 'robots');
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const canonicalLinks = tags(html, 'link').filter(tag => attribute(tag, 'rel').toLowerCase().split(/\s+/).includes('canonical'));
  assert(file, description.length >= 50 && description.length <= 170, `description doit faire 50–170 caractères (reçu ${description.length})`);
  assert(file, canonicalLinks.length === 1 && attribute(canonicalLinks[0] || '', 'href') === canonical, `canonical unique attendu : ${canonical}`);
  assert(file, /^index\s*,\s*follow$/i.test(robots), 'page publique doit être index,follow');
  assert(file, h1Count === 1, `attendu exactement un h1 (trouvé ${h1Count})`);
  const ogValues = {};
  for (const prop of ['og:title', 'og:description', 'og:url', 'og:image']) {
    ogValues[prop] = oneMeta(html, file, 'property', prop);
  }
  assert(file, ogValues['og:title'] === title, 'og:title doit reprendre le title');
  assert(file, ogValues['og:description'] === description, 'og:description doit reprendre la description');
  assert(file, ogValues['og:url'] === canonical, 'og:url doit correspondre au canonical');
  const twitter = {};
  for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    twitter[name] = oneMeta(html, file, 'name', name);
  }
  assert(file, twitter['twitter:card'] === 'summary_large_image', 'twitter:card doit utiliser le format large');
  assert(file, twitter['twitter:title'] === title && twitter['twitter:description'] === description, 'métadonnées Twitter incohérentes');
  assert(file, twitter['twitter:image'] === ogValues['og:image'], 'twitter:image doit correspondre à og:image');
  assert(file, /data-coden-logo|coden-logo-mark|M16 8L25 13\.5/i.test(html), 'logo Coden accessible sans JavaScript manquant');
  for (const image of html.matchAll(/<img\b[^>]*>/gi)) {
    assert(file, /\balt\s*=\s*["']/i.test(image[0]), `image sans attribut alt : ${image[0].slice(0, 100)}`);
  }
  structuredData(html, file, canonical, route === '/');
}

for (const file of privatePages) {
  const html = read(file);
  if (!html) continue;
  validateLanguageAndTitle(html, file);
  const description = oneMeta(html, file, 'name', 'description');
  const robots = oneMeta(html, file, 'name', 'robots');
  const route = `/${file}`;
  const canonicalLinks = tags(html, 'link').filter(tag => attribute(tag, 'rel').toLowerCase().split(/\s+/).includes('canonical'));
  assert(file, description.length >= 40, 'description privée trop courte ou manquante');
  assert(file, /^noindex\s*,\s*nofollow$/i.test(robots), 'page privée doit être noindex,nofollow');
  assert(file, canonicalLinks.length === 1 && attribute(canonicalLinks[0] || '', 'href') === `${origin}${route}`, 'canonical privée doit être unique et auto-référencé');
  assert(file, !/application\/ld\+json/i.test(html), 'les pages privées ne doivent pas publier de données structurées');
  assert(file, !/property=["']og:|name=["']twitter:/i.test(html), 'ne pas ajouter de partage social aux pages privées');
}

const robots = read('public/robots.txt');
assert('public/robots.txt', /Sitemap:\s*https:\/\/coden\.fun\/sitemap\.xml/i.test(robots), 'URL sitemap absente');
for (const route of policy.private) {
  assert('public/robots.txt', !new RegExp(`^Disallow:\\s*${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(robots), `ne pas bloquer ${route} : les robots doivent pouvoir lire noindex`);
}

const sitemap = read('public/sitemap.xml');
assert('public/sitemap.xml', /<urlset\b[^>]*xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/i.test(sitemap), 'racine XML Sitemap invalide');
const sitemapUrls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/gi), match => match[1].trim());
const expectedUrls = policy.canonicalPublic.map(route => `${origin}${route}`).sort();
assert('public/sitemap.xml', JSON.stringify([...sitemapUrls].sort()) === JSON.stringify(expectedUrls), 'le sitemap doit contenir exactement les URLs publiques canoniques');
assert('public/sitemap.xml', !/<(?:lastmod|changefreq|priority)\b/i.test(sitemap), 'ne pas générer de dates ou priorités non fiables');
assert('public/sitemap.xml', new Set(sitemapUrls).size === sitemapUrls.length, 'URL dupliquée dans le sitemap');
assert('public/sitemap.xml', !/[?#]/.test(sitemapUrls.join('')), 'le sitemap ne doit contenir ni paramètres ni fragments');

for (const [route, target] of Object.entries(policy.redirects)) {
  const expected = `${route} ${target} 301`;
  const redirects = read('public/_redirects');
  assert('public/_redirects', redirects.split(/\r?\n/).includes(expected), `redirection permanente absente : ${expected}`);
  assert('public/sitemap.xml', !sitemapUrls.includes(`${origin}${route}`), `route redirigée présente dans le sitemap : ${route}`);
  if (!route.includes(':')) {
    const sourceFile = route.endsWith('/')
      ? path.join(root, route.slice(1), 'index.html')
      : path.join(root, route.slice(1));
    assert(route, !fs.existsSync(sourceFile), 'un fichier source existe pour une route redirigée');
  }
}

for (const file of [...publicPages, ...privatePages]) {
  const html = read(file);
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || /^https?:\/\//i.test(href)) continue;
    const route = (href.split(/[?#]/)[0] || '/').replace(/\\/g, '/');
    if (policy.redirects[route]) failures.push(`${file}: lien interne vers une ancienne route ${route}; utiliser ${policy.redirects[route]}`);
  }
}

const notFound = read('404.html');
assert('404.html', /<html\b[^>]*lang=["']fr["']/i.test(notFound), 'page 404 doit déclarer le français');
assert('404.html', /name=["']robots["'][^>]*content=["']noindex, nofollow["']/i.test(notFound), 'page 404 doit être noindex,nofollow');
assert('404.html', /<h1\b/i.test(notFound) && /href=["']\/["']/.test(notFound) && /href=["']\/pricing\.html["']/.test(notFound), 'page 404 doit proposer un retour accueil et tarifs');
assert('public/sitemap.xml', !sitemapUrls.includes(`${origin}/404.html`), 'la page 404 ne doit pas être dans le sitemap');

const server = read('server.ts');
assert('server.ts', /res\.setHeader\('X-Robots-Tag', 'noindex, nofollow'\)/.test(server), 'en-tête noindex serveur manquant pour les routes utilitaires/404');
assert('server.ts', /sendFile\(path\.join\(staticDir, '404\.html'\)/.test(server), 'fallback 404 HTML serveur manquant');
assert('server.ts', /'\/built-with-coden\/:projectId'[\s\S]{0,800}X-Robots-Tag/.test(server), 'route utilitaire built-with-coden doit être noindex');

const shells = read('src/components/shells.tsx');
assert('src/components/shells.tsx', /CodenBrand/.test(shells), 'le shell React doit utiliser le logo canonique');
assert('src/components/shells.tsx', !/coden-react-brand-mark[^\n]*>H</.test(shells), 'le shell React ne doit pas afficher une marque texte legacy');
for (const file of publicPages) {
  const html = read(file);
  assert(file, /coden-marketing-header-root/.test(html), 'point de montage du header public manquant');
  assert(file, !/marketing-prompt-section|page-proof-grid|seo-panel|Start from a prompt/i.test(html), 'bloc marketing générique legacy détecté');
}

if (failures.length) {
  console.error(`SEO check failed (${failures.length} erreur(s)):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`SEO check passed : ${publicPages.length} pages publiques, ${privatePages.length} privées, sitemap et 404.`);
