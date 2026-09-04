import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The route's own wiring to the new pipeline, checked structurally.
 *
 * A behavioural test would need a live model — the proxy in this environment
 * blocks OpenRouter — and would pass against a broken branch whenever the
 * flag happened to be off, which is the default. What matters here is
 * structural: the branch exists, it is gated behind the flag, it runs before
 * any legacy blob logic could, it resolves the route from real decision
 * fields rather than re-reading the prompt, and every path out of it either
 * returns a complete response or falls through — never both, never neither.
 */

const server = readFileSync('./server.ts', 'utf8');

const generateStart = server.indexOf("app.post('/api/projects/:id/generate'");
assert.ok(generateStart > 0, 'the generate route must be findable');
const route = server.slice(generateStart, server.indexOf('\napp.post(', generateStart + 100));

// -- the branch exists, gated behind the flag, and asks the real classifier -
assert.match(route, /const pipelineRoute = resolvePipelineRoute\(\{ intent: decision\.intent, nextAction: decision\.nextAction, hasFiles: existingFiles\.length > 0 \}\);/,
  'the route must be resolved from the real decision, not re-derived from the prompt text');
assert.match(route, /if \(process\.env\.CODEN_MULTI_AGENT_PIPELINE === '1' && pipelineRoute\) \{/,
  'the branch must be gated behind an explicit flag, defaulting off since the env var is unset by default');

// -- it runs before the ~1200 lines of legacy branching, not after ----------
const pipelineBranch = route.indexOf('const pipelineRoute = resolvePipelineRoute(');
const decisionPhase = route.indexOf('const skillResolution = resolveCodenSkill(');
const generateFilesCall = route.indexOf('await generateFilesWithAi(');
assert.ok(pipelineBranch > 0 && decisionPhase > 0 && generateFilesCall > 0, 'all three anchors must be findable');
assert.ok(pipelineBranch < decisionPhase, 'the new branch must be checked before the legacy decisionPhase/skill/reliability machinery runs');
assert.ok(pipelineBranch < generateFilesCall, 'and before the old blob generator is ever called');

// -- the pipeline call itself carries what the new modules need -------------
const pipelineCall = route.slice(route.indexOf('const outcome = await runMultiAgentPipeline({'), route.indexOf('if (outcome.started) {'));
assert.match(pipelineCall, /gateway: providerGateway/, 'must reuse the one provider gateway, not a second client');
assert.match(pipelineCall, /route: pipelineRoute/);
assert.match(pipelineCall, /existingFiles/);
assert.match(pipelineCall, /harnessContext:/, 'the harness context already prepared for this request must be threaded through, not re-created');

/**
 * Every exit is exactly one of: a complete terminal response, or a fall
 * through with no return. A branch that could do neither would either hang
 * the request or silently drop the fallback the plan requires.
 */
const startedBlock = route.slice(route.indexOf('if (outcome.started) {'), route.indexOf("console.warn('[coden:multi_agent_sandbox_failed]'"));
assert.match(startedBlock, /return respondJson\(200, \{/, 'a started pipeline must end the request with a complete response');
assert.match(startedBlock, /success: outcome\.ok,\s*\n\s*needs_fix: !outcome\.ok,/, 'success and needs_fix must be the honest inverse of the reviewer\'s own verdict');
assert.match(startedBlock, /live_url: outcome\.liveUrl/, 'the live sandbox URL must reach the client exactly like the legacy path\'s');
assert.match(route, /payload\.preview\?\.live_url[\s\S]*type:'preview_ready'/, 'the verified sandbox URL must stream before final narration');
// `src/builder-live.ts` throws "The selected AI model did not return a
// usable final summary." whenever `summary`/`text`/`message` are all empty —
// a response with none of them silently breaks every generation that takes
// this branch, exactly what shipped before this assertion existed.
assert.match(startedBlock, /summary: summarizePipelineOutcome\(/, 'the response must carry a real summary field or the client throws on every pipeline run');

// The two failure exits (sandbox never started; anything else threw) must
// both be logged and neither may return — falling through to the legacy
// path is the whole point of the fallback.
const fallbackRegion = route.slice(route.indexOf("console.warn('[coden:multi_agent_sandbox_failed]'"), decisionPhase);
assert.match(fallbackRegion, /return respondJson\(503/, 'sandbox failure must terminate explicitly, not silently regenerate');
assert.match(fallbackRegion, /return respondJson\(502/, 'execution failure must preserve partial work and report the error');
assert.match(fallbackRegion, /console\.warn\('\[coden:multi_agent_pipeline_failed\]'/, 'an unexpected failure must be logged, not silently swallowed');

// -- intents that never write code must never enter the branch at all -------
// resolvePipelineRoute itself is unit-tested for this (test-edit-intent.ts);
// this pins that the route calls it before deciding anything, so a
// conversation/verify/deploy_assist/clarification intent is excluded by the
// same function every code-writing intent is included by — not a second,
// possibly-diverging check.
assert.equal((route.match(/resolvePipelineRoute\(/g) || []).length, 1, 'there must be exactly one place in the route deciding this, not a second heuristic');

console.log('multi-agent route wiring tests passed');
