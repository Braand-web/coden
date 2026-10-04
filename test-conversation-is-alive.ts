import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// No UI module is imported here: this file runs under `node
// --experimental-strip-types`, which cannot strip JSX, and the reducer's own
// behaviour is covered by `agent-conversation-ui.test.ts` under vitest. What
// this checks is the wiring between the server and that reducer.

/*
 * A conversation says what it is doing, and shows the answer as it is written.
 *
 * What a user saw was three dots, then a wait, then the whole reply at once.
 * Both halves of that had the same shape: the conversation path was never
 * told to report anything.
 *
 *  - No `activity` event is emitted anywhere in `server.ts`. Every one in the
 *    product comes from the multi-agent pipeline, so on a conversation
 *    `AgentMessageState.activity` stayed null and the thinking line fell
 *    through to its `•••` placeholder — the shimmer had no text to animate.
 *  - The call ran with `stream: false`, so those dots sat there until the
 *    entire answer had been generated. Nothing was slow by accident: the
 *    answer was withheld until it was complete, behind an intent-router call
 *    that had already run.
 */

/*
 * The component is not the bug — given a label it shimmers, given none it
 * falls back to the dots, and that fallback is right for a genuinely unknown
 * activity. Its rendering is covered by `agent-conversation-ui.test.ts`; what
 * is checked here is that a conversation stops being one of those cases.
 */
{
  const parts = readFileSync(new URL('./src/components/agent/agent-parts.ts', import.meta.url), 'utf8');

  // `activity` is the only event that gives the thinking line its text, and
  // `run_started` deliberately leaves it null — nothing is claimed before the
  // run says something. So a path that emits no activity can only show dots.
  assert.match(parts, /case 'activity': closeText\(\); next\.activity = event\.label; next\.thinking = true;/,
    'an activity event is what gives the shimmer its text');
  assert.match(parts, /case 'run_started': next\.thinking = true;/,
    'and run_started alone leaves the label unknown');
}

/*
 * The server emits that label, and streams the answer.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const branch = server.slice(server.indexOf("if (decision.intent === 'conversation' || decision.intent === 'clarification_required'"));
  const streamStart = branch.indexOf('let agentText: any;');
  const conversation = branch.slice(streamStart, branch.indexOf('await recordAgentImprovementSignal', streamStart));

  assert.match(conversation, /eventStream\?\.chat\(\{ type: 'activity', label:/, 'the run must say what it is doing');
  assert.match(conversation, /'Coden réfléchit…' : 'Coden is thinking…'/, 'in the user language');
  assert.match(conversation, /onToken: eventStream \?/, 'and hand its tokens to the stream');
  assert.match(conversation, /type: 'text_delta', delta/, 'as deltas');
  assert.match(conversation, /if \(streamedAny\) eventStream\?\.chat\(\{ type: 'text_end' \}\)/, 'closing the text only when some was actually sent');
}

/*
 * Streaming is the caller's choice, because only the caller knows whether
 * anyone is watching: a background finalizer has nowhere to put tokens, and
 * asking a provider to stream into nothing buys nothing.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  assert.match(server, /stream: Boolean\(input\.onToken\)/, 'the runtime streams only when there is a reader');
  assert.doesNotMatch(server, /\n    stream: false,\n    \/\/ This path returns a user-visible answer/, 'the hardcoded false is gone');

  // The answer is still returned whole and still sanitized: streaming shows
  // the text sooner, it does not decide what the text is.
  const fn = server.slice(server.indexOf('async function createAgentTextResponse(input: {'));
  const body = fn.slice(0, fn.indexOf('function detectExternalApiRequirements'));
  assert.match(body, /providerGateway\.streamingCompletion\(selectedModel, messages/, 'streamed through the atomic collector');
  assert.match(body, /text: sanitizeAssistantOutput\(\{/, 'and still sanitized before it is kept');

  // `onChunk` reports the accumulation, so the delta is the tail since the
  // last call — sending the accumulation would repaint the whole answer on
  // every token.
  assert.match(body, /const delta = accumulated\.slice\(seen\);/, 'only the new text is sent');
}

/*
 * Completed responses must survive a project reload with their original
 * reasoning and file steps, not just as flattened message text.
 */
{
  const stream = readFileSync(new URL('./src/services/agent-event-stream.ts', import.meta.url), 'utf8');
  const builder = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');
  const conversation = readFileSync(new URL('./src/builder-conversation-island.tsx', import.meta.url), 'utf8');
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

  assert.match(stream, /persistedChatEvents/, 'the stream retains its ordered chat events');
  assert.match(server, /ai_message_id: streamMessageId/, 'assistant history writes are idempotently keyed to the chat bubble');
  assert.match(server, /coden_stream:/, 'the rich stream is stored with the assistant response');
  assert.match(server, /const itemKey = input\.item\?\.ai_message_id/, 'snapshot retries replace the same message instead of duplicating it');
  assert.match(server, /metadata: redactSecretPayload\(row\?\.metadata \|\| \{\}\)/, 'stream metadata is redacted again when history is read');
  assert.match(builder, /conversationApi\.restoreChat\(/, 'history loading restores the rich assistant stream');
  assert.match(conversation, /restoreChat\(id, events/, 'the conversation reducer rebuilds completed messages');
  assert.match(builder, /assistantMessageId: messageHandleId\(status\)/, 'generation sends the stable assistant message id');
}

/*
 * If Supabase cannot return the conversation, an empty array is not a valid
 * substitute. The next build must be retriable, not act on forgotten choices.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const memoryLoader = server.slice(server.indexOf('async function loadSessionMemory('), server.indexOf('async function saveSessionMemory('));
  const memorySaver = server.slice(server.indexOf('async function saveSessionMemory('), server.indexOf('async function loadConversationContext('));
  const conversationLoader = server.slice(server.indexOf('async function loadConversationContext('), server.indexOf('function dropCurrentPrompt('));
  const routeStart = server.indexOf('let existingFiles: GeneratedFile[];');
  const routeEnd = server.indexOf('let initialDecision: IntentDecision;', routeStart);
  const route = server.slice(routeStart, routeEnd);

  assert.match(memoryLoader, /if \(required\) throw new Error\('Session memory could not be loaded\.'\)/,
    'the Builder must not quietly replace a failed memory read with an empty summary');
  assert.match(conversationLoader, /loadSessionMemory\(input\.project\.id, true\)/,
    'the Builder requires its saved memory');
  assert.match(memorySaver, /if \(required\) throw new Error\('Session memory could not be saved\.'\)/,
    'compaction persistence must fail visibly when its write fails');
  assert.equal((conversationLoader.match(/await saveSessionMemory\(input\.project, input\.userId, memory, true\)/g) || []).length, 2,
    'both model and deterministic compaction paths persist memory before generation');
  assert.match(conversationLoader, /listProjectMessagesPage\(input\.project\.id, 80, null, true\)/,
    'generation must treat a missing message table as an unavailable conversation');
  assert.doesNotMatch(conversationLoader, /listProjectMessagesPage\([^\n]+\.catch\(\(\) => \[\]\)/,
    'a failed message read must not become an empty conversation');
  assert.match(route, /diagnostic_code: 'PROJECT_CONTEXT_UNAVAILABLE'/,
    'the user receives a recoverable project-context error instead of a context-free build');
  assert.match(server, /const recentHistory = branchFork \? branchFork\.prefix : dropCurrentPrompt/,
    'an edited request sees only the server-derived conversation prefix');
  assert.match(server, /const sessionContext = branchFork \? undefined : conversation\.sessionContext/,
    'later original-session context cannot leak into the edited branch');
}

console.log('conversation is alive tests passed');
