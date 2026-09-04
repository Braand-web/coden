import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Every router intent must map to a real runtime action.
 *
 * `isIntentRouterStructuredOutput` validates a decision by handing
 * `runtimeActionForIntent(intent)` to `validateModelDecision`, which rejects
 * anything outside `ACTIONS`. Two of the ten intents had no mapping and fell
 * through to their own name — and neither `conversation` nor `verify` is an
 * action. So `validateModelDecision` threw "unsupported action" and the whole
 * decision was discarded, however good it was.
 *
 * Production, 2026-09-04 19:56. The model answered:
 *
 *   {"intent":"conversation","intent_category":"product_review",
 *    "confidence":0.96,"reason":"La demande porte sur des idées
 *    d'amélioration de l'application Pomodoro existante..."}
 *
 * Every field present, a sound reason, 0.96 confidence — thrown away as
 * `GENERATION_FAILED: The model JSON did not match the required contract`,
 * degraded to the local `clarification_required` fallback, and answered with
 * a 502. `conversation` is the most common intent in the product: asking
 * Coden anything about an application it had already generated could not work.
 */

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

// The runtime's own action list, read from the module that owns it.
const runtime = readFileSync(new URL('./src/services/agent-runtime-v2.ts', import.meta.url), 'utf8');
const actions = new Set(
  (/const ACTIONS = new Set<AgentAction>\(\[([^\]]+)\]\)/.exec(runtime)?.[1] || '')
    .split(',').map(entry => entry.trim().replace(/^'|'$/g, '')).filter(Boolean),
);
assert.ok(actions.size >= 5, 'the action list must be readable, or this test proves nothing');

// The intents the router is allowed to return, read from the validator itself.
const intents = (/const allowedIntents: AgentIntent\[\] = \[([^\]]+)\]/.exec(server)?.[1] || '')
  .split(',').map(entry => entry.trim().replace(/^'|'$/g, '')).filter(Boolean);
assert.ok(intents.length >= 8, 'the intent list must be readable');

// Re-derive the mapping exactly as the server does.
const body = server.slice(server.indexOf('function runtimeActionForIntent('));
const source = body.slice(0, body.indexOf('\n}\n') + 2);
// The TypeScript annotation is the only thing `new Function` cannot parse.
const runtimeActionForIntent = new Function(`${source.replace('(intent: AgentIntent)', '(intent)')}; return runtimeActionForIntent;`)() as (intent: string) => string;

for (const intent of intents) {
  const action = runtimeActionForIntent(intent);
  assert.ok(
    actions.has(action),
    `intent "${intent}" maps to "${action}", which is not a runtime action — every decision with this intent is discarded`,
  );
}

// The two that were broken, named so a regression is unambiguous.
assert.equal(runtimeActionForIntent('conversation'), 'answer', 'a conversation answers; it does not ask a question');
assert.equal(runtimeActionForIntent('verify'), 'answer', 'a verification reports its result; it does not ask a question');

/*
 * And neither may map to an action that demands a clarification question:
 * `validateModelDecision` rejects `clarify` and `confirm` without one, which
 * would reintroduce the same rejection by a different route.
 */
for (const intent of ['conversation', 'verify']) {
  assert.ok(!['clarify', 'confirm'].includes(runtimeActionForIntent(intent)), `${intent} must not require a question`);
}

// The conversation route answers in the user's language and never empty-handed.
{
  const chat = server.slice(server.indexOf("app.post('/api/assistant/chat'"));
  const handler = chat.slice(0, chat.indexOf("// POST /api/chat"));
  assert.match(handler, /publicRuntimeErrorMessage\(diagnostic\.diagnostic_code/, 'a failed conversation must say something a person can read');
  assert.match(handler, /coden:assistant_chat_failed/, 'and leave the real cause in the log');
  assert.doesNotMatch(handler, /error: diagnostic\.message,\n\s*message: diagnostic\.message,/, 'the log message must not be the user-facing one');
}

console.log('intent action mapping tests passed');
