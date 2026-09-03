import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builderLive = readFileSync('src/builder-live.ts', 'utf8');
const conversation = readFileSync('src/builder-conversation-island.tsx', 'utf8');
const streamClient = readFileSync('src/lib/stream-client.ts', 'utf8');
const streamProtocol = readFileSync('src/lib/stream-protocol.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');

assert.ok(server.includes("app.post('/api/projects/:id/generate'"), 'server should keep non-streaming generation');
assert.ok(server.includes("app.post('/api/projects/:id/generate"), 'server should keep project generation routes');
assert.ok(server.includes("/api/assistant/chat/stream"), 'server should preserve chat SSE transport');
assert.ok(streamClient.includes('export function openCodenStream'), 'SSE client transport should remain available');
assert.ok(streamProtocol.includes('isCodenStreamEvent'), 'event validation should remain available');

assert.ok(builderLive.includes('/generate?stream=true'), 'builder should request project generation SSE for the React stream UI');
assert.ok(builderLive.includes('/api/assistant/chat/stream'), 'simple conversation should request chat SSE for the React stream UI');
assert.ok(builderLive.includes('openCodenStream'), 'builder should consume the preserved SSE transport');
assert.ok(builderLive.includes("/api/projects/${encodeURIComponent(currentProjectId)}/generate"), 'builder should keep non-streaming generation fallback');
assert.ok(builderLive.includes("/api/assistant/chat"), 'simple conversation should keep non-streaming chat fallback');
// The anchor this used to assert was a TODO marker left where the old
// streaming UI had been ripped out. Pinning it kept three stubs alive: a
// shimmer that dropped its label, a delta handler that discarded the model's
// answer, and a comment where the replacement was supposed to go. The
// replacement now exists, so the assertions are on it.
assert.ok(!builderLive.includes('[REMPLACEMENT STREAMING UI ICI]'), 'the streaming UI replacement is done; the placeholder anchor must be gone');
assert.ok(!builderLive.includes('// Token-by-token rendering intentionally removed.'), 'assistant deltas must not be discarded');
assert.match(builderLive, /conversationApi\.appendAssistantDelta\(id, text\)/, 'assistant deltas must reach the renderer');
assert.ok(conversation.includes('createRoot'), 'conversation renderer should be a React runtime');
assert.ok(conversation.includes('DOMPurify'), 'assistant markdown should be sanitized');
assert.ok(conversation.includes('MarkdownIt'), 'assistant markdown should render rich markdown');
assert.ok(conversation.includes('katex'), 'assistant markdown should support math');
assert.ok(conversation.includes('coden-agent-pending'), 'generation stream should expose a visual pending indicator');
assert.ok(!conversation.includes('ShimmeringText'), 'pending state must not invent assistant copy');
assert.ok(!builderLive.includes('function buildSimpleConversationReply'), 'production builder must not contain local assistant replies');
assert.ok(!builderLive.includes('function buildPlanningOnlyReply'), 'production builder must not contain local planning replies');
assert.ok(!builderLive.includes('function buildClarificationOnlyReply'), 'production builder must not contain local clarification replies');
assert.ok(!builderLive.includes('function professionalStreamNarration'), 'production builder must not rewrite provider events into local narration');
assert.ok(!builderLive.includes('function journalEventText'), 'production builder must not synthesize journal copy from event names');
assert.ok(!builderLive.includes('function cleanPublicJournalText'), 'production builder must not contain a local public journal translator');
assert.ok(builderLive.includes('function sanitizeProviderStreamText'), 'provider stream sanitation must remain explicit and neutral');

for (const source of [builderLive, conversation]) {
  assert.ok(!source.includes('createSmoothTextRenderer'), 'frontend UI must not use smooth token rendering');
  assert.ok(!source.includes('AgentActivityStream'), 'old agent activity UI must be removed');
  assert.ok(!source.includes('Coden Mission Control'), 'mission control UI must be removed');
  assert.ok(!source.includes('work_journal'), 'work_journal block must be removed');
  assert.ok(!source.includes('coden-stream-ui'), 'phase/progress stream UI must be removed');
  assert.ok(!source.includes('message-card-shimmer'), 'shimmer streaming class must be removed');
}

assert.ok(!conversation.includes('<Reasoning'), 'internal reasoning must not be rendered in the assistant message');
assert.ok(!conversation.includes('ReasoningTrigger') && !conversation.includes('ReasoningContent'), 'reasoning primitives must not be exposed to users');
assert.ok(!conversation.includes('<ToolCall'), 'tool call card UI should be removed');
assert.ok(!conversation.includes('<TerminalBlock'), 'terminal stream UI should be removed');
assert.ok(!conversation.includes('<CodeBlock'), 'streaming code block UI should be removed');
assert.ok(!conversation.includes('<DiffView'), 'streaming diff UI should be removed');

console.log('react chat streaming contract ok');
