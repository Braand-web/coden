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
  const conversation = branch.slice(0, branch.indexOf('} catch (error: any) {'));

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

console.log('conversation is alive tests passed');
