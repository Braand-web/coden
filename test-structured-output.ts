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

console.log('structured output tests passed');
