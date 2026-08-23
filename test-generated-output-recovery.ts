import assert from 'node:assert/strict';
import {
  classifyModelOutput,
  extractPlanEnvelope,
  liftFilesAnywhere,
  repairTruncatedJson,
  salvageFiles,
} from './src/services/generated-output-recovery.ts';

// ── classifyModelOutput ─────────────────────────────────────────────────────
assert.equal(classifyModelOutput(''), 'unparseable');

const filesOutput = JSON.stringify({
  summary: 'ok',
  files: [{ path: 'src/App.tsx', content: 'export default function App(){return null}' }],
});
assert.equal(classifyModelOutput(filesOutput), 'files');

// THE Budget Pulse case from the screenshots — must classify as plan, never dumped.
const budgetPulseEnvelope = JSON.stringify({
  plan: { title: 'Plan de création de l\'application Budget Pulse', steps: [{ phase: '1.' }] },
  message: 'Bonjour ! J\'ai bien compris ton besoin pour Budget Pulse.',
});
assert.equal(classifyModelOutput(budgetPulseEnvelope), 'plan_envelope', 'plan envelope must be detected, not rendered as content');

// chat answer
assert.equal(classifyModelOutput('Bonjour ! React est une bibliothèque JavaScript.'), 'chat_answer');

// truncated JSON
assert.equal(classifyModelOutput('{"summary":"ok","files":[{"path":"src/A'), 'truncated_json');

// ── extractPlanEnvelope ─────────────────────────────────────────────────────
const env = extractPlanEnvelope(budgetPulseEnvelope);
assert.ok(env, 'plan envelope extracted');
assert.equal(env?.message?.startsWith('Bonjour'), true);
assert.ok(env?.plan && typeof env.plan === 'object');

// fenced envelope
const fenced = '```json\n' + budgetPulseEnvelope + '\n```';
assert.ok(extractPlanEnvelope(fenced), 'fenced plan envelope is also lifted');

// Real files → not classified as plan envelope.
assert.equal(extractPlanEnvelope(filesOutput), null);

// Plan + empty files[] → still a plan envelope (don't try to build nothing).
const planWithEmptyFiles = JSON.stringify({ plan: { steps: [] }, files: [], message: 'will plan first' });
assert.ok(extractPlanEnvelope(planWithEmptyFiles));

// ── liftFilesAnywhere ───────────────────────────────────────────────────────
const nested = JSON.stringify({
  envelope: { result: { files: [{ path: 'src/App.tsx', content: 'export default ()=>null' }] } },
  meta: { ok: true },
});
const lifted = liftFilesAnywhere(nested);
assert.ok(lifted && lifted.length === 1, 'files are lifted from a nested envelope');
assert.equal(lifted![0].path, 'src/App.tsx');

// Bad file shapes are rejected.
assert.equal(liftFilesAnywhere('{"files":[{"name":"x"}]}'), null);

// ── repairTruncatedJson ─────────────────────────────────────────────────────
const truncated = '{"summary":"ok","files":[{"path":"src/App.tsx","content":"export default function App(){return null}"';
const repaired = repairTruncatedJson(truncated);
assert.ok(repaired && Array.isArray(repaired.files) && repaired.files.length >= 1);
assert.equal(repaired.files[0].path, 'src/App.tsx');

// Plain text → null.
assert.equal(repairTruncatedJson('hello there'), null);

// ── salvageFiles ────────────────────────────────────────────────────────────
const salvaged = salvageFiles(truncated);
assert.ok(salvaged);
assert.equal(salvaged!.files[0].path, 'src/App.tsx');

const planEnvelopeSalvage = salvageFiles(budgetPulseEnvelope);
assert.equal(planEnvelopeSalvage, null, 'plan envelopes are NOT salvaged as files (the runtime must route as plan)');

console.log('test-generated-output-recovery passed');
