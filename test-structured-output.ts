import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrRepairStructuredObject, parseStructuredObject, StructuredOutputError } from './src/services/structured-output.ts';

const isDecision = (value: unknown): value is { intent: string; confidence: number } => {
  const item = value as any;
  return Boolean(item && typeof item.intent === 'string' && typeof item.confidence === 'number');
};

assert.deepEqual(
  parseStructuredObject('```json\n{"intent":"build","confidence":0.9}\n```', isDecision),
  { intent: 'build', confidence: 0.9 },
);
assert.throws(() => parseStructuredObject('{"intent":"build"}', isDecision), StructuredOutputError);

const repaired = await parseOrRepairStructuredObject('not-json', isDecision, async () => '{"intent":"conversation","confidence":0.8}');
assert.equal(repaired.intent, 'conversation');

const serverSource = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
assert.match(serverSource, /parseOrRepairStructuredObject\(/, 'The live intent router should repair malformed structured output.');
assert.match(serverSource, /isIntentRouterStructuredOutput/, 'Intent repairs must stay typed, not loose JSON.');

/*
 * A sound intent must survive an incomplete answer.
 *
 * The router asks for a strict json_schema, but only the OpenAI-compatible
 * adapter is actually sent one — and the call allows provider fallback, so a
 * model that never saw the schema can end up answering. Production judged
 * those answers against it, and one missing field discarded the decision:
 * every request degraded to `conversation`, so a request to build an
 * application was answered with a sentence and nothing was ever built.
 */
assert.match(serverSource, /function completeIntentRouterOutput\(/, 'the router must be able to complete an answer it can still use');
assert.match(
  serverSource,
  /isIntentRouterStructuredOutput\(completeIntentRouterOutput\(value, fallback, input\.prompt\)\)/,
  'the completion must run before the contract check, or a usable intent is still thrown away',
);
assert.match(
  serverSource,
  /buildDecisionFromAi\(rawDecision \? completeIntentRouterOutput\(rawDecision, fallback, input\.prompt\) : null, fallback\)/,
  'what was judged and what is used must be the same object',
);
// The one field that must never be invented: asking a question the model did
// not ask would put words in its mouth.
assert.doesNotMatch(
  serverSource.slice(serverSource.indexOf('function completeIntentRouterOutput('), serverSource.indexOf('function isIntentRouterStructuredOutput(')),
  /raw\.clarification\s*=/,
  'a clarification must stay exactly as the model answered it',
);

console.log('structured output tests passed');
