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

assert.match(root, /data-coden-surface="landing-retired"/, 'the root route is an explicit landing handoff');
assert.match(root, /noindex, nofollow/, 'the temporary root is not indexed');
assert.match(root, /auth\.html\?redirect=%2Fdashboard\.html/, 'the handoff keeps a working path into the SaaS');
assert.doesNotMatch(root, /landing-v3|landing-reference|data-build|cdn-pill/, 'the retired landing is absent from the root');
assert.doesNotMatch(root, /Build any SaaS instantly|customer logos|trusted by thousands/i,
  'legacy marketing filler is absent');

assert.match(pricing, /Transformez votre idée/i);
assert.match(pricing, /preview.*publish|prévisualisez.*publiez/i);
assert.match(auth, /projets.*prévisualisez.*publiez/i);

console.log('public value proposition tests passed');
