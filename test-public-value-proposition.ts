import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getProductPositioning } from './src/product-positioning.ts';

const landing = readFileSync('index.html', 'utf8');
const pricing = readFileSync('pricing.html', 'utf8');
const auth = readFileSync('auth.html', 'utf8');

const french = getProductPositioning('fr');
const english = getProductPositioning('en');

assert.match(landing, /Coden — Turn an idea into a web app with AI/);
assert.match(landing, /data-i18n="hero\.title"/);
assert.match(landing, /data-i18n="hero\.subtitle"/);
assert.match(landing, /data-i18n="hero\.cta"/);
assert.match(landing, /data-i18n="hero\.reassurance"/);
assert.match(pricing, /Transformez votre idée/i);
assert.match(pricing, /preview.*publish|prévisualisez.*publiez/i);
assert.match(auth, /projets.*prévisualisez.*publiez/i);

for (const positioning of [french, english]) {
  assert.ok(positioning.seoTitle.includes('Coden'));
  assert.ok(positioning.seoDescription.length >= 50);
  assert.ok(positioning.heroTitle.length <= 90);
  assert.ok(positioning.heroSubtitle.length <= 220);
}

assert.equal((landing.match(/<h1\b/gi) || []).length, 1);
assert.doesNotMatch(landing, /Build any SaaS instantly/i);
assert.doesNotMatch(landing, /customer logos|trusted by thousands/i);

console.log('public value proposition tests passed');
