import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('./builder.html', import.meta.url), 'utf8');
const live = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');

/*
 * ONE — the upgrade path existed everywhere except where a user could reach it.
 *
 * `builder.html` already carried a complete pricing modal: overlay, plan
 * cards, a monthly/annual toggle, CTAs. It opened from `.btn-upgrade` — a
 * class with CSS rules in ten places and markup in none, so
 * `querySelector('.btn-upgrade')` returned null and the whole modal was
 * unreachable. Styled, wired, and dead.
 */
{
  assert.match(markup, /id="project-menu-upgrade"/, 'the panel carries an upgrade control');
  assert.match(live, /getElementById\('project-menu-upgrade'\)\?\.addEventListener\('click'/, 'which is actually bound');
  assert.match(live, /function openPricingModal\(\): void \{/, 'to something that opens the modal');
  assert.match(live, /modal\.classList\.add\('active'\)/, 'by the class the overlay already listens for');

  /*
   * It must not ALSO carry `btn-upgrade`: the inline script binds that class
   * too, so both handlers would fire and the funnel event would double-count.
   */
  const button = markup.slice(markup.indexOf('id="project-menu-upgrade"') - 120, markup.indexOf('id="project-menu-upgrade"') + 40);
  assert.doesNotMatch(button, /btn-upgrade/, 'one control, one handler');
}

/*
 * TWO — the price on the card is the price on the invoice.
 *
 * The modal hardcoded $25 / $50 monthly and $20 / $40 annual. The product
 * settles in XAF (`BILLING_SETTLEMENT_CURRENCY = 'XAF'`), so a user was shown
 * dollars and charged CFA francs — the same endpoint that prices the checkout
 * was right there and unused.
 */
{
  assert.match(live, /apiFetch<any>\('\/api\/billing\/plans'\)/, 'the real plans are fetched');
  assert.match(live, /element\.dataset\.monthly = money\(plan\.amount\);/, 'and written as the monthly price');
  assert.match(live, /element\.dataset\.annual = money\(plan\.annualMonthlyEquivalent \|\| plan\.amount\);/, 'and the annual one');
  assert.match(live, /String\(plan\.currency \|\| 'XAF'\)/, 'in the currency the plan declares');

  // The hardcoded dollar prices are gone from the toggle.
  const script = markup.slice(markup.indexOf('function updateModalPrices'), markup.indexOf('if (btnMonthly && btnYearly)'));
  assert.doesNotMatch(script, /\$25|\$50|\$20|\$40/, 'no hardcoded dollar price survives');
  assert.match(script, /priceText\(pricePro, key\)/, 'the price is read from what the server said');

  /*
   * And an unanswered request shows "—", not a confident wrong number: a
   * stale price is worse than a visibly absent one, because the user acts on
   * it.
   */
  assert.match(markup, /return value \? value : "—";/, 'an unknown price stays unknown');
}

/*
 * The counter itself reports a balance, or says it could not read one.
 */
{
  assert.match(live, /async function refreshCreditCounter\(\): Promise<void>/, 'the balance is read');
  assert.match(live, /apiFetch<any>\('\/api\/billing\/wallet'\)/, 'from the wallet the server settles against');
  assert.match(live, /void refreshCreditCounter\(\);/, 'when the panel opens');

  // Zero is a claim ("you are out of credits") that sends the user to buy what
  // they may already have. An unreadable balance says so instead.
  const fn = live.slice(live.indexOf('async function refreshCreditCounter'), live.indexOf('/** Write the real plan prices'));
  assert.match(fn, /value\.textContent = '—';/, 'a failed read shows no number');
  assert.match(fn, /planLabel\.textContent = 'Solde indisponible';/, 'and says why');
  assert.match(fn, /wallet\?\.unlimited \? 'Illimité'/, 'an unlimited account is not counted down');
  assert.match(fn, /if \(creditCounterInFlight\) return creditCounterInFlight;/, 'and the panel cannot stack requests');
}

/*
 * THREE — a full-screen modal has a keyboard way out.
 */
{
  assert.match(markup, /max-width: none;\n      height: 100%;/, 'the pricing modal fills the viewport');
  assert.match(markup, /\.pricing-modal-content > \* \{/, 'while its content keeps a readable measure');
  assert.match(live, /if \(modal\?\.classList\.contains\('active'\)\) \{/, 'Escape closes it');
  assert.match(markup, /\.pricing-modal-content > \.pricing-modal-close \{\n      position: fixed;/,
    'and the close control cannot scroll away');
}

/*
 * FOUR — approving a plan does not pin the composer to build.
 *
 * The second argument already forces THAT request to build, so the
 * `setChatMode` was only ever about what happens NEXT — and it forced every
 * later message down the build route regardless of what the user typed. A
 * "merci" three turns after an approval went to the builder.
 */
{
  const approval = live.slice(live.indexOf("'Construire ce plan' : 'Build this plan'"), live.indexOf("'Ajuster le plan' : 'Adjust plan'"));
  assert.match(approval, /setChatMode\('auto'\);/, 'Auto resumes after the approval');
  assert.doesNotMatch(approval, /setChatMode\('build'\);/, 'the composer is not left pinned to build');
  // The approved plan is still built, by this request, from the stored plan.
  assert.match(approval, /generateFromPrompt\(prompt, 'build', true, \{\}, prompt\);/, 'and the plan itself is still built');
}

/*
 * FIVE — opening a project no longer waits on npm install.
 *
 * `ensureLivePreview` posts to `/sandbox/start`, which runs `npm install` and
 * boots Vite — 6.7s for the tiny tree in this repo's own sandbox test, far
 * more for a real one on a cold container. Awaiting it inside `loadProject`
 * put that install in front of `applyInitialBuilderLayout`, so opening any
 * project without a running sandbox blocked the chat, the file tree and the
 * toolbar behind a dependency install nobody was waiting to watch.
 */
{
  const load = live.slice(live.indexOf('const resumedLive = await resumeLivePreview();'));
  const body = load.slice(0, load.indexOf('syncProjectReadinessClass();'));
  assert.match(body, /void ensureLivePreview\(\);/, 'the sandbox start is launched, not awaited');
  assert.doesNotMatch(body, /await ensureLivePreview\(\);/, 'the builder no longer blocks on it');
  // The reader still gets the honest state meanwhile.
  assert.match(body, /setEmptyPreviewState\('idle'\);/, 'and is told the preview is not running yet');
}

console.log('credits and auto mode tests passed');
