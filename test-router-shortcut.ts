import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROUTER_SHORTCUT_CONFIDENCE, canRouteWithoutModel } from './src/services/router-shortcut.ts';
import { understandUserIntent } from './src/services/intent-understanding.ts';

const clear = { confidence: 0.95, needsClarification: false, action: 'build', category: 'app', allowsFileAction: true };

// The band the heuristic was measured correct on decides alone.
{
  const shortcut = canRouteWithoutModel(clear, 'auto');
  assert.equal(shortcut.skipModel, true);
  assert.equal(shortcut.reason, 'heuristic_confident:app');
}

// Everything the heuristic is not sure about still goes to the model. Each of
// these was a deliberate choice, not a default.
for (const [label, understanding, mode, reason] of [
  ['below the measured band', { ...clear, confidence: 0.89 }, 'auto', 'low_confidence'],
  ['no confidence at all', { ...clear, confidence: undefined }, 'auto', 'low_confidence'],
  ['a question the heuristic wants to ask', { ...clear, needsClarification: true }, 'auto', 'needs_clarification'],
  ['nothing recognised', { ...clear, category: 'other' }, 'auto', 'unrecognised_category'],
  ['no category', { ...clear, category: '' }, 'auto', 'unrecognised_category'],
  ['no understanding', null, 'auto', 'no_understanding'],
  ['the user steering', clear, 'build', 'explicit_mode'],
  ['plan mode', clear, 'plan', 'explicit_mode'],
] as const) {
  const shortcut = canRouteWithoutModel(understanding as any, mode);
  assert.equal(shortcut.skipModel, false, `${label} must still reach the model`);
  assert.equal(shortcut.reason, reason, `${label} must say why`);
}

// High confidence in having recognised nothing is not confidence — the case
// that would otherwise let a vague prompt skip the model at 0.95.
assert.equal(canRouteWithoutModel({ confidence: 0.99, category: 'other' }, 'auto').skipModel, false);

/**
 * The threshold has to hold on the project's own intent eval, which is the only
 * labelled set available. It is the heuristic's own test file, so agreement is
 * partly circular — that is exactly why the shortcut is limited to the band
 * measured correct rather than applied wherever the heuristic has an opinion.
 */
const evalSource = fs.readFileSync(new URL('./test-agent-intent-evals.ts', import.meta.url), 'utf8');
const listStart = evalSource.indexOf('[', evalSource.indexOf('const cases'));
const cases: Array<{ prompt: string; hasFiles?: boolean; shouldMutate: boolean }> =
  eval(evalSource.slice(listStart, evalSource.indexOf('];', listStart) + 1));

let shortcut = 0;
let wrong = 0;
for (const testCase of cases) {
  const understanding = understandUserIntent({
    prompt: testCase.prompt,
    hasFiles: Boolean(testCase.hasFiles),
    requestedMode: 'auto',
    hasLastPlan: false,
  });
  if (!canRouteWithoutModel(understanding as any, 'auto').skipModel) continue;
  shortcut += 1;
  const wouldMutate = !(understanding.action === 'answer' && !understanding.allowsFileAction) && !understanding.needsClarification;
  if (wouldMutate !== testCase.shouldMutate) {
    wrong += 1;
    console.error(`  misrouted without the model: ${testCase.prompt}`);
  }
}

assert.equal(wrong, 0, 'a request routed without the model must not be misrouted');
assert.ok(shortcut >= 25, `the shortcut must carry a real share of traffic, got ${shortcut}/${cases.length}`);
assert.ok(shortcut < cases.length, 'the model must keep a share — a shortcut that takes everything is not an escalation');

// Wiring: the shortcut must sit before the model call, and the model must still
// be reachable, or this becomes a removal rather than an escalation.
const server = fs.readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const resolveStart = server.indexOf('async function resolveAgentDecision');
const resolveBody = server.slice(resolveStart, resolveStart + 2200);
assert.ok(/canRouteWithoutModel\(/.test(resolveBody), 'the shortcut must be consulted');
assert.ok(
  resolveBody.indexOf('canRouteWithoutModel(') < resolveBody.indexOf('classifyIntentWithAi('),
  'the shortcut must be checked before the model call, or it saves nothing',
);
assert.ok(/classifyIntentWithAi\(/.test(resolveBody), 'the model must still run on what the heuristic is unsure about');
assert.ok(/routingSource: 'heuristic'/.test(resolveBody), 'a heuristic decision must be labelled as one');

console.log(`router shortcut tests passed (${shortcut}/${cases.length} routed without the model, 0 misrouted)`);
