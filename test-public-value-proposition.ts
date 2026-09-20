import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getProductPositioning } from './src/product-positioning.ts';

const root = readFileSync('index.html', 'utf8');
const pricing = readFileSync('pricing.html', 'utf8');
const auth = readFileSync('auth.html', 'utf8');

const french = getProductPositioning('fr');
const english = getProductPositioning('en');

for (const positioning of [french, english]) {
  assert.ok(positioning.seoTitle.includes('Coden'));
  assert.ok(positioning.seoDescription.length >= 50);
  assert.ok(positioning.heroTitle.length <= 90);
  assert.ok(positioning.heroSubtitle.length <= 220);
}

/*
 * The root is the landing now, not a handoff away from a retired one.
 *
 * These three asserted a temporary state — a retired landing, marked
 * `noindex`, whose only job was to forward to the SaaS. The real landing
 * shipped and replaced it, so the assertions failed on every run while
 * describing a page that no longer exists. What they were protecting is kept:
 * the root has to say which surface it is, has to be findable, and has to lead
 * somewhere useful.
 */
assert.match(root, /data-coden-surface="landing-new"/, 'the root declares which surface it is');
assert.match(root, /name="robots" content="index, follow"/, 'a landing that cannot be indexed cannot be found');
assert.match(root, /auth\.html\?mode=signup&(?:amp;)?redirect=%2Fdashboard\.html/, 'the landing keeps a working path into the SaaS');
assert.doesNotMatch(root, /landing-v3|landing-reference|data-build|cdn-pill/, 'the retired landing is absent from the root');
assert.doesNotMatch(root, /Build any SaaS instantly|customer logos|trusted by thousands/i,
  'legacy marketing filler is absent');

assert.match(pricing, /Transformez votre idée/i);
assert.match(pricing, /preview.*publish|prévisualisez.*publiez/i);
assert.match(auth, /projets.*prévisualisez.*publiez/i);

console.log('public value proposition tests passed');
