import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectModel } from './src/services/model-selection.ts';

/*
 * A user on the free plan can have an application built.
 *
 * For five days nobody could. Between 2026-09-06 15:11 and 2026-09-11 not one
 * project created on this deployment has a single file, and the production log
 * says why, verbatim, on every attempt:
 *
 *   [coden:multi_agent_pipeline_failed] {
 *     message: 'No eligible model satisfies code_generation/complex.'
 *   }
 *
 * Two defects met and multiplied:
 *
 *  1. `inferAgentTaskComplexity` returned `complex` for `intent === 'build'`
 *     unconditionally — so every generation claimed to be a hard task,
 *     "crée une mini to-do list" included.
 *  2. `selectModel` threw when no model cleared the strength bar, instead of
 *     taking the best one the user can actually reach.
 *
 * `code_generation` at `complex` demands a frontier model, every frontier
 * model requires a paid plan, and every organization here is on `free`. The
 * intersection was empty, and the throw happened on the first line of
 * `runMultiAgentPipeline` — before the plan, before the sandbox, before a
 * single credit was spent. The user watched their message leave and nothing
 * come back.
 */

const BUILD = { task: 'code_generation' as const, needs: { tools: true } };

// The exact shape that failed in production: free plan, tools needed, a build.
{
  for (const complexity of ['simple', 'medium', 'complex', 'extreme'] as const) {
    const chosen = selectModel({ ...BUILD, plan: 'free', credits: 27, complexity });
    assert.ok(chosen.modelId, `free/${complexity} must resolve to a model, not an exception`);
  }
}

// A paid plan still gets the model it pays for; degradation is a floor, never a cap.
{
  assert.equal(selectModel({ ...BUILD, plan: 'business', credits: 27, complexity: 'complex' }).modelId, 'openai/gpt-5.6-sol');
  assert.equal(selectModel({ ...BUILD, plan: 'enterprise', credits: 1000, complexity: 'extreme' }).modelId, 'openai/gpt-5.6-sol');
}

/*
 * The degradation is on the record.
 *
 * A weaker model chosen silently is a product that quietly got worse and told
 * nobody. The reason string is what a support question is answered from.
 */
{
  const degraded = selectModel({ ...BUILD, plan: 'free', credits: 27, complexity: 'complex' });
  assert.match(degraded.reason, /best accessible model/, 'the fallback must say it is a fallback');
  assert.ok(degraded.rejected.some(entry => /requires the business plan/.test(entry.because)), 'and carry what it could not reach');
}

/*
 * Only the preference bar relaxes. Every objective gate still refuses.
 *
 * This is the line between "a weaker answer" and "a wrong one": a model that
 * cannot call tools cannot build, and a context that does not fit does not
 * fit, whatever the plan.
 */
{
  assert.throws(() => selectModel({ ...BUILD, plan: 'free', complexity: 'medium', estimatedInputTokens: 100_000_000 }), /No eligible model/, 'a context that cannot fit is not a preference');
  assert.throws(() => selectModel({ ...BUILD, plan: 'free', credits: 0, complexity: 'medium' }), /No eligible model/, 'credits are not a preference');
  assert.throws(() => selectModel({ ...BUILD, plan: 'free', requestedModel: 'acme/not-a-model' as any }), /not available/, 'an unknown pinned model is not a preference');
}

/*
 * Security stays fail-closed, and it is the one task where that is right.
 *
 * A weaker model returning "nothing found" reads exactly like a real audit
 * that found nothing. Everywhere else the user can see the application and
 * judge it; here a false all-clear is worse than an honest refusal.
 */
{
  assert.throws(() => selectModel({ task: 'security', plan: 'free', complexity: 'complex' }), /No eligible model satisfies security/);
}

/*
 * And a build no longer declares itself hard just for being a build.
 *
 * `intent === 'build'` says code will be written; `autoPlanRequired` says the
 * user should approve a plan first. Neither is a statement about difficulty,
 * and together they made every generation `complex`.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const fn = server.slice(server.indexOf('function inferAgentTaskComplexity('), server.indexOf('function routingModeForPolicy('));
  const complexBranch = fn.slice(fn.indexOf("=== 'balanced'"), fn.indexOf("return 'complex';"));

  assert.doesNotMatch(complexBranch, /decision\.intent === 'build'/, 'being a build is not a difficulty signal');
  assert.doesNotMatch(complexBranch, /decision\.autoPlanRequired/, 'needing a plan is about consent, not capability');

  // The signals that do mean difficulty are still there.
  assert.match(complexBranch, /riskyTerms\.some/, 'auth, payments and migrations still raise it');
  assert.match(complexBranch, /files\.length > 10/, 'so does a large existing codebase');
  assert.match(complexBranch, /text\.length > 900/, 'and a long brief');

  // A build lands at medium, which every plan can serve.
  const mediumBranch = fn.slice(fn.indexOf("return 'complex';"), fn.indexOf("return 'medium';"));
  assert.match(mediumBranch, /decision\.intent === 'build'/, 'a build is more than a conversation, and less than a crisis');
}

console.log('generation reachable tests passed');
