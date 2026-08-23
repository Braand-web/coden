import assert from 'node:assert/strict';
import {
  ToolCallStreamAccumulator,
  collectFromMessageToolCalls,
  isCompleteJson,
} from './src/services/tool-call-stream-accumulator.ts';

// ── isCompleteJson ──────────────────────────────────────────────────────────
assert.equal(isCompleteJson(''), true);          // no-args tool is OK
assert.equal(isCompleteJson('{"path":"a"}'), true);
assert.equal(isCompleteJson('{"path":"a'), false);
assert.equal(isCompleteJson('{'), false);

// ── Streaming: name and arguments arrive in many chunks ──────────────────────
const a = new ToolCallStreamAccumulator();
// First chunk: id + name + partial args.
a.ingestDelta({ index: 0, id: 'call_1', function: { name: 'write_file', arguments: '{"path":"src/' } });
assert.equal(a.hasCompleteCalls(), false);
// Subsequent fragments.
a.ingestDelta({ index: 0, function: { arguments: 'App.tsx","content":"' } });
a.ingestDelta({ index: 0, function: { arguments: 'export default ()=>null"}' } });
assert.equal(a.hasCompleteCalls(), true);
let out = a.finalize();
assert.equal(out.length, 1);
assert.equal(out[0].id, 'call_1');
assert.equal(out[0].function.name, 'write_file');
const parsed = JSON.parse(out[0].function.arguments);
assert.equal(parsed.path, 'src/App.tsx');
assert.equal(parsed.content, 'export default ()=>null');

// ── Parallel tool calling (two indices interleaved) ──────────────────────────
const p = new ToolCallStreamAccumulator();
p.ingestDeltaArray([
  { index: 0, id: 'c0', function: { name: 'write_file', arguments: '{"path":"a' } },
  { index: 1, id: 'c1', function: { name: 'run_check', arguments: '{"kind":"' } },
]);
p.ingestDeltaArray([
  { index: 0, function: { arguments: '","content":"A"}' } },
  { index: 1, function: { arguments: 'build"}' } },
]);
assert.equal(p.hasCompleteCalls(), true);
out = p.finalize();
assert.equal(out.length, 2);
assert.deepEqual(out.map(c => c.function.name), ['write_file', 'run_check']);
// Order preserved by index.
assert.equal(JSON.parse(out[0].function.arguments).path, 'a');
assert.equal(JSON.parse(out[1].function.arguments).kind, 'build');

// ── Incomplete: name missing → dropped ──────────────────────────────────────
const inc = new ToolCallStreamAccumulator();
inc.ingestDelta({ index: 0, function: { arguments: '{"x":1}' } });
assert.equal(inc.finalize().length, 0, 'calls without a name are dropped');

// ── No-call deltas (just text streaming) ────────────────────────────────────
const t = new ToolCallStreamAccumulator();
t.ingestDeltaArray(undefined);
t.ingestDeltaArray(null);
assert.equal(t.hasCalls(), false);
assert.equal(t.finalize().length, 0);

// ── Synthetic indexing when the stream omits `index` ────────────────────────
const s = new ToolCallStreamAccumulator();
s.ingestDelta({ id: 'x', function: { name: 'read_file', arguments: '{"path":"a"}' } });
s.ingestDelta({ id: 'y', function: { name: 'read_file', arguments: '{"path":"b"}' } });
const sOut = s.finalize();
assert.equal(sOut.length, 2);
assert.equal(JSON.parse(sOut[0].function.arguments).path, 'a');
assert.equal(JSON.parse(sOut[1].function.arguments).path, 'b');

// ── Non-streaming OpenAI message ────────────────────────────────────────────
const oai = collectFromMessageToolCalls({
  tool_calls: [
    { id: 'c1', function: { name: 'write_file', arguments: '{"path":"a.tsx","content":"X"}' } },
    { function: { name: 'run_check', arguments: { kind: 'build' } } }, // arguments object → JSON.stringify
  ],
});
assert.equal(oai.length, 2);
assert.equal(oai[0].id, 'c1');
assert.equal(JSON.parse(oai[1].function.arguments).kind, 'build');

// ── Anthropic-shaped content blocks ─────────────────────────────────────────
const anth = collectFromMessageToolCalls({
  content: [
    { type: 'text', text: 'thinking…' },
    { type: 'tool_use', id: 'tu_1', name: 'write_file', input: { path: 'src/x.ts', content: 'x' } },
    { type: 'tool_use', name: 'run_check', input: { kind: 'typecheck' } },
  ],
});
assert.equal(anth.length, 2);
assert.equal(anth[0].function.name, 'write_file');
assert.equal(JSON.parse(anth[0].function.arguments).path, 'src/x.ts');
assert.equal(anth[1].id, 'call_1');

console.log('test-tool-call-stream-accumulator passed');
