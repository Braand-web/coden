import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The conversation contract, with the streaming removed.
 *
 * This file used to pin the SSE transport in place — the client opening a
 * stream, the server exposing one, the deltas reaching the renderer. That
 * whole layer was deleted on purpose, to be replaced, so those assertions are
 * now inverted: what must not come back is a second, accidental streaming
 * path, and what must survive is everything the conversation still needs to
 * render an answer honestly.
 */

const builderLive = readFileSync('src/builder-live.ts', 'utf8');
const conversation = readFileSync('src/builder-conversation-island.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');

// -- the request/response contract the client actually uses now -------------
assert.ok(server.includes("app.post('/api/projects/:id/generate'"), 'the generation route must remain');
assert.ok(server.includes("app.post('/api/assistant/chat'"), 'the conversation route must remain');
assert.ok(builderLive.includes("/api/projects/${encodeURIComponent(projectId)}/generate"), 'the builder must call the generation route');
assert.ok(builderLive.includes("'/api/assistant/chat'"), 'the builder must call the conversation route');

// -- the streaming layer is gone, on both sides -----------------------------
for (const [name, source] of [['builder', builderLive], ['conversation', conversation], ['server', server]] as const) {
  assert.ok(!source.includes('stream=true'), `${name} must not request a generation stream`);
  assert.ok(!source.includes('openCodenStream'), `${name} must not open an SSE transport`);
  assert.ok(!source.includes('coden-stream-v2'), `${name} must not speak the removed wire protocol`);
  assert.ok(!source.includes('assistant_delta'), `${name} must not carry streamed deltas`);
}
assert.ok(!server.includes("'/api/assistant/chat/stream'"), 'the chat SSE endpoint must not come back');
assert.ok(!existsSync('src/lib/stream-protocol.ts'), 'the wire protocol module must stay deleted');
assert.ok(!existsSync('src/lib/stream-client.ts'), 'the SSE client transport must stay deleted');
assert.ok(!existsSync('src/services/agent-run-store.ts'), 'the run view model must stay deleted');

// -- the assistant's words are the model's, never the browser's -------------
assert.ok(!builderLive.includes('function buildSimpleConversationReply'), 'production builder must not contain local assistant replies');
assert.ok(!builderLive.includes('function buildPlanningOnlyReply'), 'production builder must not contain local planning replies');
assert.ok(!builderLive.includes('function buildClarificationOnlyReply'), 'production builder must not contain local clarification replies');
assert.ok(!builderLive.includes('function professionalStreamNarration'), 'production builder must not rewrite provider events into local narration');
assert.ok(!builderLive.includes('function journalEventText'), 'production builder must not synthesize journal copy from event names');
assert.ok(!builderLive.includes('function cleanPublicJournalText'), 'production builder must not contain a local public journal translator');
assert.ok(builderLive.includes('function sanitizeProviderStreamText'), 'provider text sanitation must remain explicit and neutral');

// -- the renderer that survived ---------------------------------------------
assert.ok(conversation.includes('createRoot'), 'conversation renderer should be a React runtime');
assert.ok(conversation.includes('DOMPurify'), 'assistant markdown should be sanitized');
assert.ok(conversation.includes('MarkdownIt'), 'assistant markdown should render rich markdown');
assert.ok(conversation.includes('katex'), 'assistant markdown should support math');
assert.ok(conversation.includes('coden-agent-pending'), 'a request in flight must still show a pending indicator');

assert.ok(!conversation.includes('<Reasoning'), 'internal reasoning must not be rendered in the assistant message');
assert.ok(!conversation.includes('ReasoningTrigger') && !conversation.includes('ReasoningContent'), 'reasoning primitives must not be exposed to users');
assert.ok(!conversation.includes('<ToolCall'), 'tool call card UI should be removed');
assert.ok(!conversation.includes('<TerminalBlock'), 'terminal stream UI should be removed');
assert.ok(!conversation.includes('<DiffView'), 'streaming diff UI should be removed');

console.log('conversation contract ok');
