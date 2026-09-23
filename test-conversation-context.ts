import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * What the model is given for a reply.
 *
 * The agent "did not understand": the question arrived inside a JSON payload
 * under 64k characters of policy, previous turns were flattened into the same
 * string (or missing entirely on /generate), and a plan or deploy question was
 * answered in forced JSON mode. These pin the shape that fixed it.
 */
const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const builder = server.slice(server.indexOf('function buildAgentTextMessages('), server.indexOf('async function createAgentTextResponse('));

assert.match(builder, /\.\.\.history\.map\(turn => \(\{ role: turn\.role, content: turn\.content \}\)/, 'previous turns are sent as real messages');
assert.doesNotMatch(builder, /request: prompt,/, 'the question is not buried in a JSON payload');
assert.match(builder, /content: visionInputs\?\.length \? buildVisionMessageContent\(request, visionInputs\) : request/, 'the last message is the user\'s own text');
assert.doesNotMatch(builder, /Follow it exactly/, 'internal flags are facts, never orders');

assert.match(server, /prompt,\n\s+history: historyTurns,/, 'the chat route passes the conversation as turns');
assert.equal((server.match(/history: recentHistory,/g) || []).length >= 2, true, '/generate text replies get the conversation too');
assert.doesNotMatch(server, /promptWithHistory/, 'no flattened history string remains');
assert.match(server, /preferStructuredOutput: input\.mode === 'generation',/, 'prose replies are never forced into JSON mode');

console.log('conversation context tests passed');

/*
 * Memory across turns and across rounds, the way Claude Code keeps a session.
 */
{
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /const rounds: ChatMessage\[\]\[\] = \[\];/, 'a run keeps its rounds');
  assert.match(pipeline, /\.\.\.carried,/, 'and the next round receives them');
  assert.match(pipeline, /rounds\.push\(carryOverTranscript\(loop\.messages\.slice\(1 \+ carried\.length\), loop\.result\?\.text\)\)/, 'recorded as a valid transcript, without duplicating the carried prefix');

  assert.match(server, /loadConversationContext\(\{\n\s+project,\n\s+userId,/, '/generate loads the conversation window and its summary');
  assert.doesNotMatch(server.slice(server.indexOf("app.post('/api/projects/:id/generate'")), /getRecentDecisionHistory\(project\.id, 6\)/, 'not the last six clipped messages');
  assert.match(server, /memoryContext: \[projectMemory, sessionContext\]/, 'the build agents get the session memory');
  assert.match(server, /void recordSessionRun\(project, userId, \{/, 'every build leaves a run record');
  assert.match(server, /sessionContext: canPersistConversation \? renderSessionContext\(await loadSessionMemory\(project\.id\)\) : undefined/, 'a project chat knows what was built');
}
console.log('session memory wiring tests passed');
