import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getProductPositioning } from './src/product-positioning.ts';

const french = getProductPositioning('fr');
const english = getProductPositioning('en');

for (const copy of [french, english]) {
  for (const [key, value] of Object.entries(copy)) {
    assert.equal(typeof value, 'string', `${key} must be a string`);
    assert.ok(value.trim().length > 0, `${key} must not be empty`);
    assert.ok(!/\[.*?\]|lorem ipsum/i.test(value), `${key} must not contain placeholder copy`);
  }
}

assert.match(french.heroTitle, /idée.*application web/i);
assert.match(english.heroTitle, /idea.*web app/i);
assert.match(french.heroSubtitle, /construit.*vérifie.*publier/i);
assert.match(english.heroSubtitle, /builds.*verifies.*publish/i);
assert.match(french.primaryCta, /Créer mon application/i);
assert.match(english.primaryCta, /Create my app/i);
assert.match(french.refineLabel, /agent/i);
assert.match(english.refineLabel, /agent/i);

const root = readFileSync('index.html', 'utf8');
const landingI18n = readFileSync('src/landing-i18n.ts', 'utf8');
const flow = readFileSync('src/services/create-project-flow.ts', 'utf8');

// Same retired-landing assumption as in test-public-value-proposition: the
// real landing shipped, so the root is the landing and is meant to be found.
assert.match(root, /data-coden-surface="landing-new"/, 'the root explicitly marks its surface');
assert.match(root, /name="robots" content="index, follow"/, 'the landing is indexable');
assert.doesNotMatch(root, /landing-v3|landing-reference|cdn-nav|data-build/, 'the legacy landing is absent');
assert.match(landingI18n, /FR_POSITIONING = getProductPositioning\('fr'\)/);
assert.match(landingI18n, /'nav\.open'/);
assert.match(landingI18n, /'footer\.ctaButton'/);
assert.match(flow, /export type CreateProjectFlowStatus/);
assert.match(flow, /sessionStorage\.setItem\(FLOW_STORAGE_KEY/);
assert.match(flow, /builder\.html/);

console.log('product positioning tests passed');
