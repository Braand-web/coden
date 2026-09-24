import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('./builder.html', import.meta.url), 'utf8');
const live = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');

/*
 * ONE — there is one pricing surface, and it is Settings → Facturation.
 *
 * The builder used to carry a second one: a full-screen modal with its own
 * plan cards and its own price list, which had drifted to hardcoded dollars
 * while the product settles in XAF. The settings tab already renders the real
 * plans from `/api/billing/plans` in the plan's own currency, beside the
 * balance, the top-up selector and the renewal date. Two pricing screens meant
 * two places to keep correct, and one of them was already wrong.
 */
{
  assert.match(markup, /id="project-menu-upgrade"/, 'the panel carries an upgrade control');
  assert.match(live, /getElementById\('project-menu-upgrade'\)\?\.addEventListener\('click'/, 'which is bound');
  assert.match(live, /function openUpgradeSettings\(\): void \{/, 'to the settings route');
  assert.match(live, /new CustomEvent\('coden:open-settings', \{ detail: \{ tab: 'billing' \} \}\)/,
    "opening the billing tab ('billing' is aliased to 'facturation' by the panel)");

  // The modal is gone entirely: markup, styles and its inline script.
  assert.doesNotMatch(markup, /pricing-modal/, 'no modal markup or styles survive');
  assert.doesNotMatch(markup, /p-plans-grid|p-plan-cta|p-billing-toggle/, 'nor any of its parts');
  assert.doesNotMatch(live, /openPricingModal|hydratePlanPrices/, 'and no code still feeds it');
}

/*
 * TWO — the credit counter reports a balance, and tells the badges the plan.
 *
 * `currentPlanKey` was declared 'free' and assigned in exactly one place:
 * inside `syncBuilderPlanBadges`, from the argument it was called with, which
 * was `currentPlanKey`. A closed loop seeded with 'free'. Every paying
 * customer's badge read "Free" and every `pane-plan-tag` marked their own
 * features locked — while the real plan sat on the wallet response this
 * function already fetched.
 */
{
  assert.match(live, /async function refreshCreditCounter\(\): Promise<void>/, 'the balance is read');
  assert.match(live, /apiFetch<any>\('\/api\/billing\/wallet'\)/, 'from the wallet the server settles against');
  assert.match(live, /syncBuilderPlanBadges\(plan\);/, 'and the badges are told the real plan');

  // Once per page load, not only when the project menu happens to open.
  const data = live.slice(live.indexOf('function init() {'), live.indexOf("if (document.readyState === 'loading')"));
  assert.match(data, /void refreshCreditCounter\(\);/, 'read once at load');

  const fn = live.slice(live.indexOf('async function refreshCreditCounter'), live.indexOf('function openUpgradeSettings'));
  assert.match(fn, /value\.textContent = '—';/, 'a failed read shows no number');
  assert.match(fn, /planLabel\.textContent = 'Solde indisponible';/, 'and says why');
  assert.match(fn, /wallet\?\.unlimited \? 'Illimité'/, 'an unlimited account is not counted down');
  assert.match(fn, /if \(creditCounterInFlight\) return creditCounterInFlight;/, 'and requests cannot stack');
}

/*
 * THREE — work is reserved before provider spend and settled after delivery.
 *
 * A post-hoc charge lets a costly run finish before discovering that its
 * credits cannot be debited. The canonical ledger reserves the published
 * action price first, then records measured provider cost and settles the
 * same reservation only after files reached the project.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const branch = server.slice(
    server.indexOf('if (CODEN_AGENT_FLAGS.multiAgentPipeline && pipelineRoute && hostSandboxExecutionAllowed())'),
    server.indexOf('const publicGoal = String(decision.modelObjective?.goal'),
  );

  assert.match(branch, /pipelineReservation = await reserveUnifiedUsage\(/, 'the pipeline reserves before its provider work');
  assert.match(branch, /credits: pipelineCost\.finalCredits,/, 'the exact published action price is reserved');
  assert.match(branch, /providerCostUsd: pipelineProviderCostUsd,/, 'against the measured provider spend');
  assert.match(branch, /await settleUnifiedUsage\(/, 'the reservation is settled idempotently after delivery');
  assert.match(branch, /creditsCharged: pipelineCost\.finalCredits,/, 'settlement cannot invent a different customer price');
  assert.match(branch, /await releaseUnifiedUsage\(pipelineReservation\)/, 'failed work releases its reservation');

  // The reservation precedes the model; settlement follows the durable save.
  assert.ok(
    branch.indexOf('pipelineReservation = await reserveUnifiedUsage') < branch.indexOf('const outcome = await runMultiAgentPipeline'),
    'no provider work starts before the reservation',
  );
  assert.ok(
    branch.indexOf('await saveProject(updatedProject, pipelineFiles);') < branch.indexOf('await settleUnifiedUsage'),
    'a successful debit is finalized only after files are saved',
  );
  assert.match(branch, /\[coden:pipeline_settlement_pending\]/, 'an idempotent settlement failure is left for reconciliation');

  // The measured cost has to reach the caller at all: it was accumulated per
  // round and reported only to the harness, so there was nothing to bill on.
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /costUsd: spent\.costUsd,/, 'the run reports what it spent');
  assert.match(pipeline, /\/\*\* Measured provider spend for the whole run, in USD\. What the caller bills on\. \*\//,
    'and the type says so');

  const standard = server.slice(
    server.indexOf('const refId = `gen_${randomUUID()}`;'),
    server.indexOf('// Whatever step the run died on stops spinning'),
  );
  assert.match(standard, /credits: cost\.finalCredits,/, 'the standard generator also reserves the exact public price');
  assert.doesNotMatch(standard, /cost\.finalCredits \* 1\.5/, 'the standard generator does not reserve a hidden 50 percent surcharge');
  assert.match(standard, /measuredProviderCostUsd \+= Number\(planResponse\.cost_usd/, 'planner spend is measured');
  assert.match(standard, /measuredProviderCostUsd \+= Number\(repairGeneration\.cost_usd/, 'model-backed repair spend is measured');
  assert.match(standard, /measuredProviderCostUsd \+= Number\(repairTurn\?\.spend\.costUsd/, 'tool-repair spend is measured');
  assert.match(standard, /measuredProviderCostUsd \+= Number\(finalizer\.cost_usd/, 'finalizer spend is measured');
  assert.match(standard, /creditsCharged: cost\.finalCredits,/, 'successful settlement uses the same exact public price');
  assert.match(standard, /releaseFailedGenerationUsage/, 'failed or needs-fix work records COGS and releases customer credits');
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

/*
 * SIX — the Cloud tab groups usage by project, not by project name.
 *
 * `loadCloudConsoleUsage` filtered the credit ledger with
 * `item.project_name === currentProjectName`, and the server exposed only the
 * name even though it already selected `project_id` in the same query. A name
 * is not an identity: renaming a project made its entire usage history vanish
 * from the Cloud tab, because the ledger rows keep the name they were written
 * with — and the rename button sits two rows above the credit counter. Two
 * projects sharing a name merged into one.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  assert.match(server, /project_id: row\.usage_events\?\.project_id \|\| null,/, 'the ledger row carries the project id');

  const usage = live.slice(live.indexOf('async function loadCloudConsoleUsage'), live.indexOf('async function loadCloudConsoleAnalytics'));
  assert.match(usage, /item\.project_id === currentProjectId/, 'and the tab groups on it');
  // Rows written before the id was exposed must not disappear on deploy.
  assert.match(usage, /: item\.project_name === currentProjectName/, 'older rows still match by name');
}

console.log('cloud tab identity tests passed');
