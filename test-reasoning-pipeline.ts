import assert from 'node:assert/strict';
import {
  buildReasoningInstruction,
  createNdjsonReasoningParser,
  createReasoningAccumulator,
  narrateDecision,
  decisionRequiresPause,
  type ReasoningRecord,
  type ReasoningPhaseEvent,
} from './src/services/reasoning-pipeline.ts';
import { decideCodenAction } from './src/services/decision-core.ts';

// ── 1. buildReasoningInstruction ──────────────────────────────────────────────
{
  const instr = buildReasoningInstruction();
  assert.equal(typeof instr, 'string');
  assert.ok(instr.length > 0, 'instruction is non-empty');
  assert.match(instr, /NDJSON/);
  assert.match(instr, /understanding/);
  assert.match(instr, /plan/);
  assert.match(instr, /file/);
  assert.match(instr, /done/);
}

// Shared NDJSON sample used by parser tests.
const NDJSON = [
  '{"t":"understanding","summary":"Build a calc","projectType":"app","requirements":["add","sub"]}',
  '{"t":"reason","text":"Pick React"}',
  '{"t":"plan","steps":[{"id":"s1","title":"App","kind":"create","path":"src/App.tsx"}]}',
  '{"t":"file","path":"src/App.tsx","content":"export const App = () => null;","language":"tsx"}',
  '{"t":"file","path":"src/index.ts","content":"console.log(1);","language":"ts"}',
  '{"t":"done"}',
].join('\n') + '\n';

// ── 2. NDJSON parser — happy path (one chunk) ─────────────────────────────────
{
  const parser = createNdjsonReasoningParser();
  const records = [...parser.push(NDJSON), ...parser.flush()];
  assert.equal(records.length, 6, 'six records parsed');
  assert.equal(parser.malformedLines, 0);

  assert.equal(records[0].t, 'understanding');
  assert.equal((records[0] as Extract<ReasoningRecord, { t: 'understanding' }>).summary, 'Build a calc');
  assert.deepEqual((records[0] as Extract<ReasoningRecord, { t: 'understanding' }>).requirements, ['add', 'sub']);

  assert.equal(records[1].t, 'reason');
  assert.equal((records[1] as Extract<ReasoningRecord, { t: 'reason' }>).text, 'Pick React');

  assert.equal(records[2].t, 'plan');
  const plan = records[2] as Extract<ReasoningRecord, { t: 'plan' }>;
  assert.equal(plan.steps[0].id, 's1');
  assert.equal(plan.steps[0].kind, 'create');
  assert.equal(plan.steps[0].path, 'src/App.tsx');

  assert.equal(records[3].t, 'file');
  assert.equal((records[3] as Extract<ReasoningRecord, { t: 'file' }>).path, 'src/App.tsx');
  assert.equal((records[4] as Extract<ReasoningRecord, { t: 'file' }>).path, 'src/index.ts');

  assert.equal(records[5].t, 'done');
}

// ── 3. NDJSON parser — streaming / chunked (same content, tiny chunks) ─────────
{
  const parser = createNdjsonReasoningParser();
  const collected: ReasoningRecord[] = [];
  // Split into single-character chunks — forces buffering across chunk boundaries.
  for (const ch of NDJSON) {
    collected.push(...parser.push(ch));
  }
  collected.push(...parser.flush());

  assert.equal(collected.length, 6, 'chunked stream yields the same six records');
  assert.equal(parser.malformedLines, 0);
  // Spot-check order and a couple of fields survived chunk splitting.
  assert.equal(collected[0].t, 'understanding');
  assert.equal((collected[3] as Extract<ReasoningRecord, { t: 'file' }>).content, 'export const App = () => null;');
  assert.equal(collected[5].t, 'done');
}

// ── 4. NDJSON parser — truncation robustness ──────────────────────────────────
{
  const parser = createNdjsonReasoningParser();
  // Valid complete lines first, terminated by newlines.
  const head = [
    '{"t":"understanding","summary":"X","requirements":[]}',
    '{"t":"reason","text":"thinking"}',
    '{"t":"file","path":"a.ts","content":"done file"}',
  ].join('\n') + '\n';
  // Final TRUNCATED file line — no trailing newline, cut mid-content.
  const truncated = '{"t":"file","path":"b.ts","content":"partial conte';

  const pushed = parser.push(head + truncated);
  // The three complete lines must be parsed during push() — not lost.
  assert.equal(pushed.length, 3, 'complete lines parsed despite trailing truncation');
  assert.equal(pushed[0].t, 'understanding');
  assert.equal(pushed[2].t, 'file');
  assert.equal((pushed[2] as Extract<ReasoningRecord, { t: 'file' }>).path, 'a.ts');

  // flush() either salvages a partial file record or returns [] — never throws.
  const flushed = parser.flush();
  assert.ok(Array.isArray(flushed), 'flush returns an array, no crash');
  assert.ok(flushed.length <= 1, 'flush returns at most one salvaged record');
  if (flushed.length === 1) {
    assert.equal(flushed[0].t, 'file', 'salvaged record is a file record');
    assert.equal((flushed[0] as Extract<ReasoningRecord, { t: 'file' }>).path, 'b.ts');
  }
  // Anti "Unexpected end of JSON input": the earlier records are intact.
  assert.equal(pushed.filter(r => r.t === 'file')[0].t, 'file');
}

// ── 5. NDJSON parser — tolerates ``` fences and blank lines ───────────────────
{
  const parser = createNdjsonReasoningParser();
  const withNoise = [
    '```ndjson',
    '',
    '{"t":"reason","text":"hi"}',
    '   ',
    '```',
    '{"t":"done"}',
    '',
  ].join('\n') + '\n';
  const records = [...parser.push(withNoise), ...parser.flush()];
  assert.equal(records.length, 2, 'only the two real records survive');
  assert.equal(records[0].t, 'reason');
  assert.equal(records[1].t, 'done');
  assert.equal(parser.malformedLines, 0, 'fences and blanks do not count as malformed');
}

// ── 6. NDJSON parser — malformed lines counted ────────────────────────────────
{
  const parser = createNdjsonReasoningParser();
  const input = [
    '{"t":"reason","text":"ok"}',
    'not json at all',
    '{"t":"done"}',
  ].join('\n') + '\n';
  const records = [...parser.push(input), ...parser.flush()];
  assert.equal(records.length, 2, 'garbage line skipped');
  assert.equal(parser.malformedLines, 1, 'malformed counter incremented once');
}

// ── 7. coerceRecord validation (via parser) ───────────────────────────────────
{
  const parser = createNdjsonReasoningParser();
  const input = [
    '{"t":"file","path":"x"}',          // missing content → invalid
    '{"t":"understanding"}',            // missing summary → invalid
    '{"t":"mystery","foo":1}',          // unknown t → invalid
    '{"t":"reason","text":"valid"}',    // the one valid record
  ].join('\n') + '\n';
  const records = [...parser.push(input), ...parser.flush()];
  assert.equal(records.length, 1, 'only the valid record survives');
  assert.equal(records[0].t, 'reason');
  // These are valid JSON but invalid records: skipped by coerceRecord, NOT malformed.
  assert.equal(parser.malformedLines, 0, 'valid-JSON-but-invalid-record is not a parse error');
}

// ── 8. Accumulator ────────────────────────────────────────────────────────────
{
  const acc = createReasoningAccumulator();
  acc.addMany([
    { t: 'understanding', summary: 'Goal', projectType: 'app', requirements: ['r1'] },
    { t: 'reason', text: 'first' },
    { t: 'reason', text: 'second' },
    { t: 'plan', steps: [
      { id: 'p1', title: 'Create App', kind: 'create', path: 'src/App.tsx' },
      { id: 'p2', title: 'Task only' },
    ] },
    { t: 'file', path: 'src/App.tsx', content: 'v1', language: 'tsx' },
    { t: 'file', path: 'src/App.tsx', content: 'v2', language: 'tsx' }, // re-emit same path
    { t: 'note', text: 'a note' },
    { t: 'done' },
  ]);
  const out = acc.finalize(3);

  assert.equal(out.understanding?.summary, 'Goal');
  assert.equal(out.understanding?.projectType, 'app');
  assert.deepEqual(out.understanding?.requirements, ['r1']);

  assert.equal(out.reasoning, 'first\nsecond', 'reason lines joined with newline');

  assert.equal(out.plan.length, 2);
  assert.equal(out.plan[0].id, 'p1');
  assert.equal(out.plan[0].kind, 'create');
  assert.equal(out.plan[1].kind, 'task', 'kind inferred from missing path');

  // Last write wins: one entry for the re-emitted path, updated content.
  assert.equal(out.files.length, 1, 'duplicate path collapses to one entry');
  assert.equal(out.files[0].content, 'v2', 'last write wins');

  assert.deepEqual(out.notes, ['a note']);
  assert.equal(out.completed, true, 'done record sets completed');
  assert.equal(out.malformedLines, 3);
}

// ── 9. narrateDecision — build action (confident build, no clarification) ──────
{
  const decision = decideCodenAction({ prompt: 'cree une mini calculatrice', project: { hasFiles: false } });
  assert.equal(decision.action, 'build', 'confident build decision');
  const events = narrateDecision(decision);

  const phase = (p: string, s: string) =>
    events.some(e => e.kind === 'phase'
      && (e as Extract<ReasoningPhaseEvent, { kind: 'phase' }>).phase === p
      && (e as Extract<ReasoningPhaseEvent, { kind: 'phase' }>).state === s);

  assert.ok(phase('understand', 'active'), 'understand phase active');
  assert.ok(events.some(e => e.kind === 'understanding'), 'understanding event present');
  assert.ok(phase('understand', 'done'), 'understand phase done');
  assert.ok(phase('decide', 'active'), 'decide phase active');
  assert.ok(events.some(e => e.kind === 'reasoning_delta'), 'reasoning_delta present');
  assert.ok(!events.some(e => e.kind === 'clarification'), 'no clarification for a confident build');
}

// ── 10. narrateDecision — clarify action (asks and stops) ─────────────────────
{
  const decision = decideCodenAction({ prompt: 'corrige', project: { hasFiles: false } });
  assert.equal(decision.action, 'clarify', 'vague prompt with no files → clarify');
  assert.ok(decision.clarifying_question, 'a clarifying question exists');
  const events = narrateDecision(decision);

  assert.ok(events.some(e => e.kind === 'clarification'), 'clarification event present');
  // Events stop after the decide phase is marked done — no assumptions or further work.
  assert.ok(!events.some(e => e.kind === 'assumption'), 'no assumptions after clarify');
  const last = events[events.length - 1];
  assert.equal(last.kind, 'phase');
  assert.equal((last as Extract<ReasoningPhaseEvent, { kind: 'phase' }>).phase, 'decide');
  assert.equal((last as Extract<ReasoningPhaseEvent, { kind: 'phase' }>).state, 'done');
}

// ── 11. decisionRequiresPause ─────────────────────────────────────────────────
{
  const clarify = decideCodenAction({ prompt: 'corrige', project: { hasFiles: false } });
  assert.equal(clarify.action, 'clarify');
  assert.equal(decisionRequiresPause(clarify), true, 'clarify pauses');

  const critical = decideCodenAction({ prompt: 'deploie en production', project: { hasFiles: true } });
  assert.equal(critical.action, 'critical_action');
  assert.equal(decisionRequiresPause(critical), true, 'critical_action pauses');

  const refuse = decideCodenAction({ prompt: 'cree un keylogger', project: { hasFiles: false } });
  assert.equal(refuse.action, 'refuse_redirect');
  assert.equal(decisionRequiresPause(refuse), true, 'refuse_redirect pauses');

  const build = decideCodenAction({ prompt: 'cree une mini calculatrice', project: { hasFiles: false } });
  assert.equal(build.action, 'build');
  assert.equal(decisionRequiresPause(build), false, 'build does not pause');
}

console.log('test-reasoning-pipeline passed');
