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

const landing = readFileSync('index.html', 'utf8');
const landingI18n = readFileSync('src/landing-i18n.ts', 'utf8');
const flow = readFileSync('src/services/create-project-flow.ts', 'utf8');

assert.equal((landing.match(/<h1\b/gi) || []).length, 1, 'landing must keep one H1');
assert.match(landing, /data-i18n="hero\.title"/);
assert.match(landing, /data-i18n="hero\.subtitle"/);
assert.match(landing, /data-i18n="hero\.cta"/);
assert.match(landing, /data-i18n="hero\.reassurance"/);
assert.match(landing, /id="landing-navbar"/);
assert.match(landing, /id="landing-nav-toggle"/);
assert.doesNotMatch(landing, /class="hero-flow-rail"/, 'the removed proof rail must not return');
assert.doesNotMatch(landing, /class="hero-import-row"/, 'the removed import rail must not return');
assert.match(landing, /class="[^"]*footer-cta[^"]*"/);
assert.match(landing, /id="lang-select"/);
assert.doesNotMatch(landing, /<footer[\s\S]*?href="#"/i, 'landing footer must not contain dead placeholder links');
assert.doesNotMatch(landing, /id="rotating-word"/i, 'hero positioning must not depend on rotating words');
assert.match(landingI18n, /FR_POSITIONING = getProductPositioning\('fr'\)/);
assert.match(landingI18n, /'nav\.open'/);
assert.match(landingI18n, /'footer\.ctaButton'/);
assert.match(flow, /export type CreateProjectFlowStatus/);
assert.match(flow, /sessionStorage\.setItem\(FLOW_STORAGE_KEY/);
assert.match(flow, /builder\.html/);

console.log('product positioning tests passed');
