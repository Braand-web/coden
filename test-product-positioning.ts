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
// Without scripting the page must still offer the real routes. The old markup
// also carried a menu toggle in there, which could not open anything without
// the script that drives it — so the assertion is on the links, not the button.
assert.match(landing, /id="landing-navbar"/);
for (const route of ['/features.html', '/pricing.html', '/documentation.html', '/auth.html']) {
  assert.ok(
    new RegExp(`<noscript>[\\s\\S]*?href="${route}"[\\s\\S]*?</noscript>`).test(landing),
    `the no-script navigation must reach ${route}`,
  );
}
assert.doesNotMatch(landing, /class="hero-flow-rail"/, 'the removed proof rail must not return');
assert.doesNotMatch(landing, /class="hero-import-row"/, 'the removed import rail must not return');
// The closing call to action, whatever it is called: one link to sign-up that
// carries the conversion event the funnel counts.
assert.match(landing, /data-conversion-event="start_building_click"[^>]*data-conversion-place="footer"/);
assert.match(landing, /id="lang-select"/);

// The hero composer is the product's entry point; every control the prompt
// wiring binds to has to survive a redesign of the page around it.
for (const hook of ['id="ai-textarea"', 'id="submit-btn"', 'class="input-wrapper"', 'id="model-select-btn"', 'data-prompt-mode="auto"']) {
  assert.ok(landing.includes(hook), `the hero composer must keep ${hook}`);
}

// The hero pipeline quotes the generator. If a phase label is reworded in the
// product, the marketing copy has to be reworded with it, not left behind.
const phaseLabels = readFileSync('src/services/generation-phases.ts', 'utf8');
for (const [key, label] of [
  ['run.p1', 'understand'], ['run.p4', 'build'], ['run.p6', 'fix'], ['run.p8', 'recap'],
] as const) {
  const french = new RegExp(`${label}: \\{ fr: '([^']+)'`).exec(phaseLabels)?.[1];
  assert.ok(french, `generation-phases must define a French label for ${label}`);
  assert.match(landing, new RegExp(`data-i18n="${key}"`));
  assert.ok(landingI18n.includes(`'${key}': '${french}'`), `${key} must quote the ${label} label verbatim`);
}
assert.doesNotMatch(landing, /<footer[\s\S]*?href="#"/i, 'landing footer must not contain dead placeholder links');
assert.doesNotMatch(landing, /id="rotating-word"/i, 'hero positioning must not depend on rotating words');
assert.match(landingI18n, /FR_POSITIONING = getProductPositioning\('fr'\)/);
assert.match(landingI18n, /'nav\.open'/);
assert.match(landingI18n, /'footer\.ctaButton'/);
assert.match(flow, /export type CreateProjectFlowStatus/);
assert.match(flow, /sessionStorage\.setItem\(FLOW_STORAGE_KEY/);
assert.match(flow, /builder\.html/);

console.log('product positioning tests passed');
