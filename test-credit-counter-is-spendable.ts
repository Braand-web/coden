import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UNIFIED_USAGE_CATEGORIES,
  spendableByCategory,
  sharedCredits,
  grantCoversCategory,
} from './src/services/credit-visibility.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const server = read('./server.ts');
const settings = read('./src/settings-panel.ts');
const builder = read('./src/builder-live.ts');

/*
 * The counter says what the next request can spend.
 *
 * This is the 13 September failure, reproduced as arithmetic. The account held
 * a free plan's allowances: build 30 (5 a day, capped at 30 a month), cloud 20,
 * ai_gateway 4 — and the AI allowance had been spent. The wallet summed all
 * three restrictions into one number, showed 30, and let the message through;
 * the reservation drew only from `ai_gateway` and `general`, found nothing, and
 * the answer was generated, paid for, saved and then discarded with "the model
 * is temporarily unavailable".
 */
{
  const grants = [
    { usage_restriction: 'build', credits_remaining: 30 },
    { usage_restriction: 'cloud', credits_remaining: 20 },
    { usage_restriction: 'ai_gateway', credits_remaining: 0 },
  ];

  const total = grants.reduce((sum, grant) => sum + grant.credits_remaining, 0);
  assert.equal(total, 50, 'the total is real money and is not being called wrong');

  const spendable = spendableByCategory(grants);
  assert.equal(spendable.ai_gateway, 0, 'but a message has nothing to spend, and the counter now says so');
  assert.equal(spendable.build, 30, 'while a build still has its own allowance');
  assert.equal(spendable.cloud, 20, 'and a deploy has its own');
  assert.notEqual(spendable.ai_gateway, total, 'the two numbers are not interchangeable, which was the whole bug');
}

/*
 * Shared credit pays for anything, so it counts inside every category.
 *
 * A top-up is issued with restriction `general`. Under the old readout it was
 * keyed by its KIND, `topup`, so it appeared under none of the three
 * categories it can actually pay for — a customer who had just bought credit
 * saw the same zero as before the purchase.
 */
{
  const grants = [
    { usage_restriction: 'ai_gateway', credits_remaining: 4 },
    { usage_restriction: 'general', credits_remaining: 100 },
  ];
  const spendable = spendableByCategory(grants);

  assert.equal(spendable.ai_gateway, 104, 'a top-up is spendable on chat');
  assert.equal(spendable.build, 100, 'and on builds');
  assert.equal(spendable.cloud, 100, 'and on deploys');
  assert.equal(sharedCredits(grants), 100, 'and is reported once on its own');

  /*
   * Which is why it is reported separately: adding the categories up would
   * count the same 100 credits three times and invent 200 that do not exist.
   */
  const naiveSum = UNIFIED_USAGE_CATEGORIES.reduce((sum, category) => sum + spendable[category], 0);
  assert.ok(naiveSum > 104 + 100, 'the categories deliberately overlap');
}

/* An empty account reports zero for every category, not undefined. */
{
  const spendable = spendableByCategory([]);
  for (const category of UNIFIED_USAGE_CATEGORIES) {
    assert.equal(spendable[category], 0, `${category} reads 0 rather than blank`);
  }
  assert.equal(sharedCredits([]), 0, 'and so does shared credit');
}

/* A negative or malformed remaining balance never inflates a category. */
{
  const spendable = spendableByCategory([
    { usage_restriction: 'build', credits_remaining: -5 },
    { usage_restriction: 'build', credits_remaining: Number.NaN },
    { usage_restriction: 'build', credits_remaining: 7 },
  ]);
  assert.equal(spendable.build, 7, 'only positive, real remainders count');
}

/*
 * The predicate is the reservation RPC's, not an approximation of it.
 *
 * `coden_billing_reserve` selects grants whose usage_restriction is the
 * category being charged or `general`. Anything else — a cloud grant against a
 * chat, an unknown restriction — must not count.
 */
{
  assert.ok(grantCoversCategory({ usage_restriction: 'ai_gateway', credits_remaining: 1 }, 'ai_gateway'));
  assert.ok(grantCoversCategory({ usage_restriction: 'general', credits_remaining: 1 }, 'ai_gateway'));
  assert.ok(!grantCoversCategory({ usage_restriction: 'cloud', credits_remaining: 1 }, 'ai_gateway'));
  assert.ok(!grantCoversCategory({ usage_restriction: 'promotional', credits_remaining: 1 }, 'ai_gateway'));

  // And the server's own gate reads the same two restrictions.
  assert.match(server, /\.in\('usage_restriction', \[category, 'general'\]\)/,
    'the pre-flight balance check filters on the same axis');
}

/*
 * The server reports it, and the categories cannot drift from the debit's.
 */
{
  assert.match(server, /import \{\s*\n?\s*UNIFIED_USAGE_CATEGORIES,\s*\n?\s*spendableByCategory,\s*\n?\s*sharedCredits,/,
    'the server uses the shared module rather than its own reduce');
  assert.match(server, /const spendable = spendableByCategory\(grants\);/, 'the snapshot computes it');
  assert.match(server, /const shared = sharedCredits\(grants\);/, 'and the shared figure');
  assert.match(server, /category: \(typeof UNIFIED_USAGE_CATEGORIES\)\[number\];/,
    'and a reservation can only name a category the readout also reports');

  // Both endpoints that publish a balance publish the spendable figures too.
  const walletRoute = server.slice(server.indexOf("app.get('/api/billing/wallet'"));
  assert.match(walletRoute.slice(0, 2000), /spendable: CODEN_MONETIZATION_ENABLED/, '/billing/wallet exposes it');
  assert.match(server, /\/\/ Per category, on the axis the debit actually uses\./, '/ai-usage exposes it');
}

/*
 * And the surfaces read it.
 *
 * These four slots read `breakdown`, which is keyed by grant KIND. Two of them
 * were therefore never right at all: a top-up showed under no category, and
 * "General credits" asked for a key that is a restriction and never a kind, so
 * it displayed nothing on any account, ever.
 */
{
  const render = settings.slice(settings.indexOf('function renderAiUsage('));
  assert.match(render, /const spendable = data\.wallet\?\.spendable \|\| \{\};/, 'the settings panel reads spendable');
  assert.match(render, /buildGrant\.textContent = formatCredits\(spendable\.build\)/, 'build is on the debit axis');
  assert.match(render, /cloudGrant\.textContent = formatCredits\(spendable\.cloud\)/, 'so is cloud');
  assert.match(render, /aiGrant\.textContent = formatCredits\(spendable\.ai_gateway\)/, 'so is chat');
  assert.match(render, /generalGrant\.textContent = formatCredits\(data\.wallet\?\.shared\)/,
    'and the shared slot finally has a value to show');

  const slots = render.slice(0, render.indexOf('const history ='));
  assert.doesNotMatch(slots, /formatCredits\(breakdown\./, 'none of the four reads the kind axis any more');

  // The Builder's project panel led with the same misleading total.
  assert.match(builder, /const spendable = payload\.wallet\?\.spendable \|\| \{\};/, 'the Builder reads it too');
  assert.match(builder, /Discuter avec l’agent<\/span><strong>\$\{credits\(spendable\.ai_gateway\)\}/,
    'and shows what the next message can spend');
}

console.log('credit counter tests passed');
