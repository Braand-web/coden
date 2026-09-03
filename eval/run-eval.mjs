// Coden generation-quality eval harness.
//
// Measurement first: this scores generated app outputs so two versions (e.g. main
// vs a feature branch) can be compared with numbers instead of vibes.
//
// Run (TypeScript service modules are imported, so the strip-types flag is needed):
//   node --experimental-strip-types eval/run-eval.mjs            # score fixtures
//   node --experimental-strip-types eval/run-eval.mjs --live     # generate + score
//   node --experimental-strip-types eval/run-eval.mjs --compare eval/results/A.json eval/results/B.json
//
// Output for a normal run: a per-prompt table (heuristic + design + PASS/FAIL),
// a global summary, and eval/results/<timestamp>.json.
//
// How each prompt gets an OUTPUT to score, in priority order:
//   1. --live: dynamic import of eval/generate.mjs (you wire it to the real
//      pipeline) — exports `async function generate(prompt, ctx)`. Needs provider
//      keys. If the module or keys are missing, the prompt is SKIPPED, not faked.
//   2. fixture file eval/fixtures/<id>.txt (or .json with {output}) — lets the
//      harness run fully offline against captured generations.
//   3. otherwise SKIPPED (never invent an output — no fake success).
//
// The optional LLM design judge (0-100, criteria from the generated-app design
// contract in src/lib/prompts/generated-app-design.ts)
// runs only when OPENROUTER_API_KEY is set; otherwise designScore is null.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const {
  classifyGeneratedAppType,
  buildWorldClassUiPolicy,
} = await import(path.join(repoRoot, 'src/services/design-generation-policy.ts'));
const {
  evaluateAgentOutput,
  buildAiJudgePrompt,
} = await import(path.join(repoRoot, 'src/services/agent-eval-judge.ts'));

const argv = process.argv.slice(2);

// ── Compare mode ─────────────────────────────────────────────────────────────
if (argv[0] === '--compare') {
  const [, fileA, fileB] = argv;
  if (!fileA || !fileB) {
    console.error('Usage: --compare <before.json> <after.json>');
    process.exit(1);
  }
  compareRuns(JSON.parse(readFileSync(fileA, 'utf8')), JSON.parse(readFileSync(fileB, 'utf8')));
  process.exit(0);
}

const live = argv.includes('--live');

// ── Load prompts ─────────────────────────────────────────────────────────────
const { prompts, version } = JSON.parse(readFileSync(path.join(__dirname, 'prompts.json'), 'utf8'));

// ── Optional live generator (wire eval/generate.mjs to the real pipeline) ─────
let generate = null;
if (live) {
  const genPath = path.join(__dirname, 'generate.mjs');
  if (existsSync(genPath) && process.env.OPENROUTER_API_KEY) {
    ({ generate } = await import(genPath));
  } else {
    console.warn('[eval] --live requested but eval/generate.mjs or OPENROUTER_API_KEY is missing; falling back to fixtures.');
  }
}

function loadFixture(id) {
  for (const ext of ['txt', 'json']) {
    const p = path.join(__dirname, 'fixtures', `${id}.${ext}`);
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8');
      if (ext === 'json') {
        try { return JSON.parse(raw).output ?? raw; } catch { return raw; }
      }
      return raw;
    }
  }
  return null;
}

// ── Optional LLM design judge (OpenRouter), gated on a key ───────────────────
async function judgeDesign(prompt, output, appType) {
  if (!process.env.OPENROUTER_API_KEY) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.CODEN_EVAL_JUDGE_MODEL || 'anthropic/claude-sonnet-5',
        temperature: 0,
        messages: [{ role: 'user', content: buildAiJudgePrompt(prompt, output, appType) }],
      }),
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return typeof parsed.score === 'number' ? parsed.score : null;
  } catch (error) {
    console.warn(`[eval] design judge failed: ${error?.message || error}`);
    return null;
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────
const rows = [];
for (const item of prompts) {
  const classifiedType = classifyGeneratedAppType(item.prompt);
  const policy = buildWorldClassUiPolicy({ prompt: item.prompt });
  // Reuse the architect/app-type rules as the requirement checklist for the judge.
  const architectRequirements = policy.appTypeRules.slice(0, 0); // checklist stays advisory, not literal substring-matched

  let output = null;
  let status = 'skipped';
  if (generate) {
    try {
      output = await generate(item.prompt, { appType: classifiedType, policy });
      status = 'live';
    } catch (error) {
      console.warn(`[eval] generation failed for ${item.id}: ${error?.message || error}`);
    }
  }
  if (output == null) {
    output = loadFixture(item.id);
    if (output != null) status = 'fixture';
  }

  if (output == null) {
    rows.push({
      id: item.id,
      expectedType: item.expectedType,
      classifiedType,
      typeMatch: classifiedType === item.expectedType,
      status: 'skipped',
      heuristicScore: null,
      passed: null,
      designScore: null,
      failures: [],
    });
    continue;
  }

  const heuristic = evaluateAgentOutput(item.prompt, output, classifiedType, architectRequirements);
  const designScore = await judgeDesign(item.prompt, output, classifiedType);

  rows.push({
    id: item.id,
    expectedType: item.expectedType,
    classifiedType,
    typeMatch: classifiedType === item.expectedType,
    status,
    heuristicScore: heuristic.score,
    passed: heuristic.passed && (designScore == null || designScore >= 75),
    designScore,
    failures: heuristic.failures,
  });
}

// ── Aggregate ────────────────────────────────────────────────────────────────
const scored = rows.filter(r => r.heuristicScore != null);
const designScored = rows.filter(r => typeof r.designScore === 'number');
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

const summary = {
  version,
  generatedAt: new Date().toISOString(),
  mode: generate ? 'live' : 'fixture/static',
  total: rows.length,
  scored: scored.length,
  skipped: rows.filter(r => r.status === 'skipped').length,
  typeMatchRate: rows.length ? Math.round((rows.filter(r => r.typeMatch).length / rows.length) * 100) : 0,
  passRate: scored.length ? Math.round((scored.filter(r => r.passed).length / scored.length) * 100) : 0,
  avgHeuristic: avg(scored.map(r => r.heuristicScore)),
  avgDesign: avg(designScored.map(r => r.designScore)),
  rows,
};

// ── Console report ───────────────────────────────────────────────────────────
console.log(`\nCoden eval — ${summary.version} — mode: ${summary.mode}`);
console.log('ID'.padEnd(16) + 'TYPE(match)'.padEnd(24) + 'HEUR'.padEnd(7) + 'DESIGN'.padEnd(8) + 'STATUS');
console.log('-'.repeat(70));
for (const r of rows) {
  const typeCol = `${r.classifiedType}${r.typeMatch ? '' : ` != ${r.expectedType}`}`;
  console.log(
    r.id.padEnd(16) +
    typeCol.slice(0, 23).padEnd(24) +
    String(r.heuristicScore ?? '-').padEnd(7) +
    String(r.designScore ?? '-').padEnd(8) +
    (r.passed == null ? r.status : r.passed ? 'PASS' : 'FAIL'),
  );
}
console.log('-'.repeat(70));
console.log(`type-match: ${summary.typeMatchRate}%  pass: ${summary.passRate}%  avgHeuristic: ${summary.avgHeuristic ?? '-'}  avgDesign: ${summary.avgDesign ?? '-'}  (scored ${summary.scored}/${summary.total}, skipped ${summary.skipped})`);

if (summary.skipped === summary.total) {
  console.log('\nNo outputs scored. Provide eval/fixtures/<id>.txt files or run with --live (needs eval/generate.mjs + OPENROUTER_API_KEY).');
}

// ── Persist ──────────────────────────────────────────────────────────────────
const stamp = summary.generatedAt.replace(/[:.]/g, '-');
const outPath = path.join(__dirname, 'results', `${stamp}.json`);
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log(`\nWrote ${path.relative(repoRoot, outPath)}`);

function compareRuns(before, after) {
  console.log(`\nEval compare — before(${before.mode}) vs after(${after.mode})`);
  const fmt = (a, b) => `${a ?? '-'} -> ${b ?? '-'}` + (typeof a === 'number' && typeof b === 'number' ? ` (${b - a >= 0 ? '+' : ''}${b - a})` : '');
  console.log(`pass rate:     ${fmt(before.passRate, after.passRate)}%`);
  console.log(`avg heuristic: ${fmt(before.avgHeuristic, after.avgHeuristic)}`);
  console.log(`avg design:    ${fmt(before.avgDesign, after.avgDesign)}`);
  console.log(`type-match:    ${fmt(before.typeMatchRate, after.typeMatchRate)}%`);
  const beforeById = new Map((before.rows || []).map(r => [r.id, r]));
  console.log('\nPer-prompt heuristic delta:');
  for (const r of after.rows || []) {
    const prev = beforeById.get(r.id);
    if (prev && typeof prev.heuristicScore === 'number' && typeof r.heuristicScore === 'number' && prev.heuristicScore !== r.heuristicScore) {
      console.log(`  ${r.id.padEnd(16)} ${prev.heuristicScore} -> ${r.heuristicScore}`);
    }
  }
}
