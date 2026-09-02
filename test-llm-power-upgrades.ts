import assert from 'node:assert/strict';
import { applyPromptCaching, isCacheableSize } from './src/services/prompt-caching.ts';
import {
  CODEN_AGENT_TOOLS,
  parseToolCall,
  parseToolCallsToFiles,
  hasFileWrites,
} from './src/services/agent-tools.ts';
import {
  parseBuildErrors,
  buildAutoFixPrompt,
  hasBlockingErrors,
} from './src/services/build-error-autofix.ts';

// ───────────────────────── Prompt caching (#3) ─────────────────────────
const bigSystem = 'SYSTEM POLICY '.repeat(400); // > 2200 chars
assert.equal(isCacheableSize(bigSystem), true);
assert.equal(isCacheableSize('short'), false);

const msgs = [
  { role: 'system' as const, content: bigSystem },
  { role: 'user' as const, content: 'small request' },
];
// Non-anthropic → unchanged.
assert.equal(applyPromptCaching(msgs, 'openai'), msgs);
// Caching follows the model, not the transport. Claude routed through
// OpenRouter still bills a cached prefix at ~10%, so keying off the adapter
// alone disabled caching on the default path and re-sent the whole static
// prompt at full price on every call.
for (const claudeModel of ['anthropic/claude-sonnet-5', 'anthropic/claude-opus-5', 'claude-fable-5']) {
  const viaOpenRouter = applyPromptCaching(msgs, 'openrouter', claudeModel);
  assert.notEqual(viaOpenRouter, msgs, `${claudeModel} must be cached through OpenRouter`);
  assert.ok((viaOpenRouter[0].content as unknown as any[])[0].cache_control, `${claudeModel} system block must carry a breakpoint`);
}
// Models that cache automatically (or not at all) must not receive a breakpoint
// they would reject or ignore.
for (const other of ['openai/gpt-5.6-luna', 'google/gemini-3.7-flash', 'x-ai/grok-4.6', '']) {
  assert.equal(applyPromptCaching(msgs, 'openrouter', other), msgs, `${other || '(no model)'} must stay unchanged`);
}
// Anthropic → system wrapped with cache_control.
const cached = applyPromptCaching(msgs, 'anthropic');
assert.notEqual(cached, msgs);
assert.ok(Array.isArray(cached[0].content));
const sysPart = (cached[0].content as any[])[0];
assert.equal(sysPart.type, 'text');
assert.deepEqual(sysPart.cache_control, { type: 'ephemeral' });
// Small user message stays a string (not worth a breakpoint).
assert.equal(typeof cached[1].content, 'string');
// At most 4 breakpoints.
const many = Array.from({ length: 10 }, () => ({ role: 'system' as const, content: bigSystem }));
const cachedMany = applyPromptCaching(many, 'anthropic');
const breakpointCount = cachedMany.filter(m => Array.isArray(m.content) && (m.content as any[]).some(p => p.cache_control)).length;
assert.equal(breakpointCount, 4, 'caps at 4 breakpoints');
// Array content: largest text part gets the breakpoint.
const arrMsg = [{ role: 'user' as const, content: [
  { type: 'text' as const, text: 'tiny' },
  { type: 'text' as const, text: bigSystem },
  { type: 'image_url' as const, image_url: { url: 'https://x/y.png' } },
] }];
const cachedArr = applyPromptCaching(arrMsg, 'anthropic');
const parts = cachedArr[0].content as any[];
assert.ok(parts[1].cache_control, 'largest text part is cached');
assert.ok(!parts[0].cache_control && !parts[2].cache_control);

// ───────────────────────── Tool calling (#2) ─────────────────────────
assert.equal(CODEN_AGENT_TOOLS.length, 4);
assert.deepEqual(CODEN_AGENT_TOOLS.map(t => t.name).sort(), ['apply_migration', 'read_file', 'run_check', 'write_file']);

// OpenAI-style tool call.
const openaiCall = { id: '1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/App.tsx', content: 'export default ()=>null', language: 'tsx' }) } };
const parsedOpenai = parseToolCall(openaiCall);
assert.equal(parsedOpenai.tool, 'write_file');
assert.equal((parsedOpenai as any).path, 'src/App.tsx');

// Anthropic-style tool call.
const anthropicCall = { name: 'write_file', input: { path: 'src/main.tsx', content: 'render()' } };
assert.equal(parseToolCall(anthropicCall).tool, 'write_file');

// run_check + apply_migration + read_file.
assert.equal(parseToolCall({ name: 'run_check', input: { kind: 'build' } }).tool, 'run_check');
const mig = parseToolCall({ name: 'apply_migration', input: { sql: 'create table x()', allow_destructive: true } });
assert.equal(mig.tool, 'apply_migration');
assert.equal((mig as any).allow_destructive, true);
assert.equal(parseToolCall({ name: 'read_file', input: { path: 'src/App.tsx' } }).tool, 'read_file');

// Unknown / malformed.
assert.equal(parseToolCall({ name: 'frobnicate', input: {} }).tool, 'unknown');
assert.equal(parseToolCall({ function: { name: 'write_file', arguments: '{bad json' } }).tool, 'unknown');

// Aggregation: last write wins, dedupe by path.
const calls = [
  { function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.tsx', content: 'v1' }) } },
  { function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.tsx', content: 'v2' }) } },
  { function: { name: 'write_file', arguments: JSON.stringify({ path: 'b.css', content: 'body{}' }) } },
  { function: { name: 'run_check', arguments: JSON.stringify({ kind: 'build' }) } },
];
const files = parseToolCallsToFiles(calls);
assert.equal(files.length, 2);
assert.equal(files.find(f => f.path === 'a.tsx')?.content, 'v2');
assert.equal(hasFileWrites(calls), true);
assert.equal(hasFileWrites([{ function: { name: 'run_check', arguments: '{}' } }]), false);

// ───────────────────────── Build-error auto-fix (#6) ─────────────────────────
const tscOutput = [
  "src/App.tsx(12,5): error TS2304: Cannot find name 'foo'.",
  "src/lib/data.ts(3,10): error TS2322: Type 'string' is not assignable to type 'number'.",
  'Found 2 errors.',
].join('\n');
const diags = parseBuildErrors(tscOutput);
assert.equal(diags.length, 2);
assert.equal(diags[0].file, 'src/App.tsx');
assert.equal(diags[0].line, 12);
assert.equal(diags[0].code, 'TS2304');
assert.equal(hasBlockingErrors(diags), true);

const fix = buildAutoFixPrompt(tscOutput);
assert.equal(fix.needsFix, true);
assert.deepEqual(fix.files.sort(), ['src/App.tsx', 'src/lib/data.ts']);
assert.match(fix.prompt, /Edit only these files/);
assert.match(fix.prompt, /TS2304/);

// Vite resolve error.
const viteOut = '[vite]: Rollup failed to resolve import "missing-lib" from "src/App.tsx".';
const viteDiags = parseBuildErrors(viteOut);
assert.ok(viteDiags.some(d => /resolve/.test(d.message)));

// Clean build → no fix needed.
const clean = buildAutoFixPrompt('vite build\n✓ built in 1.2s\n');
assert.equal(clean.needsFix, false);

console.log('test-llm-power-upgrades passed');
