import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

/**
 * Reading a project's own failures.
 *
 * The parsers are checked against real compiler and bundler output, and the
 * end-to-end case against a project that is genuinely broken — an import of a
 * package that is not installed, which is the single most common way a
 * generated app fails. The point is not that the check reports failure; it is
 * that what it reports is enough to fix the thing without regenerating it.
 */

process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-validate-test-${process.pid}`);

const { parseTypecheckOutput, parseRuntimeOutput, packageFromSpecifier, buildRepairInstruction, validateProject } =
  await import('./src/services/sandbox/validate.ts');
const { ProjectSandbox } = await import('./src/services/sandbox/project-sandbox.ts');
const { STARTERS, applyStarter } = await import('./src/services/sandbox/starters.ts');

// -- telling a missing file from a missing dependency ------------------
// They need different repairs: one is a file to write, the other an install.
assert.equal(packageFromSpecifier('./Header'), null);
assert.equal(packageFromSpecifier('../lib/db'), null);
assert.equal(packageFromSpecifier('@/components/Card'), null, 'the src alias is a local path');
assert.equal(packageFromSpecifier('node:fs'), null);
assert.equal(packageFromSpecifier('zustand'), 'zustand');
assert.equal(packageFromSpecifier('date-fns/format'), 'date-fns');
assert.equal(packageFromSpecifier('@tanstack/react-query'), '@tanstack/react-query');
assert.equal(packageFromSpecifier('@tanstack/react-query/devtools'), '@tanstack/react-query');

// -- tsc output --------------------------------------------------------
const tsc = parseTypecheckOutput([
  "src/App.tsx(12,5): error TS2307: Cannot find module './Header' or its corresponding type declarations.",
  "src/lib/api.ts(3,22): error TS2307: Cannot find module 'zustand' or its corresponding type declarations.",
  'src/App.tsx(20,9): error TS2322: Type \'string\' is not assignable to type \'number\'.',
  'Found 3 errors in 2 files.',
].join('\n'));
assert.equal(tsc.length, 3, 'the summary line is not an error');
assert.equal(tsc[0].file, 'src/App.tsx');
assert.equal(tsc[0].line, 12);
assert.equal(tsc[0].missingPackage, undefined, "'./Header' is a file to write, not a package to install");
assert.equal(tsc[1].missingPackage, 'zustand');
assert.equal(tsc[2].missingPackage, undefined);

// -- bundler output ----------------------------------------------------
const vite = parseRuntimeOutput([
  '[plugin:vite:import-analysis] Failed to resolve import "@tanstack/react-query" from "src/App.tsx". Does the file exist?',
  '  Plugin: vite:import-analysis',
  '  File: /tmp/x/src/App.tsx:2:30',
  'Failed to resolve import "@tanstack/react-query" from "src/App.tsx". Does the file exist?',
  '  VITE v6.4.3  ready in 258 ms',
].join('\n'), 'build');
assert.equal(vite.length, 1, 'one unresolved import is one problem, however many lines mention it');
assert.equal(vite[0].missingPackage, '@tanstack/react-query');
assert.equal(vite[0].file, 'src/App.tsx');
assert.equal(parseRuntimeOutput('  VITE v6.4.3  ready in 258 ms\n  Local: http://127.0.0.1:5173/', 'dev_server').length, 0,
  'a healthy startup is not a problem');

// -- the repair instruction --------------------------------------------
const instruction = buildRepairInstruction({
  ok: false,
  ran: { devServer: true, typecheck: true, build: false },
  durationMs: 1,
  problems: [...tsc, ...vite],
});
assert.match(instruction, /src\/App\.tsx:12/);
assert.match(instruction, /Missing dependencies: zustand, @tanstack\/react-query/);
assert.match(instruction, /Change only these files: src\/App\.tsx, src\/lib\/api\.ts/,
  'naming the files is what keeps a repair from becoming a regeneration');
assert.equal(buildRepairInstruction({ ok: true, ran: { devServer: true, typecheck: true, build: true }, durationMs: 1, problems: [] }), '',
  'a project that works needs no instruction');

// -- against a project that is really broken ---------------------------
const sandbox = new ProjectSandbox('validate-project');
try {
  const project = applyStarter(STARTERS['react-vite'], [{
    path: 'src/App.tsx',
    // Imports a package nobody installed: the most common way a generated app
    // fails, and one no static analysis of the source can catch.
    content: "import { create } from 'zustand';\n\nconst useStore = create(() => ({ count: 0 }));\n\nexport default function App() {\n  const { count } = useStore();\n  return <h1>{count}</h1>;\n}\n",
  }]);
  await sandbox.writeFiles(project.files);
  assert.ok((await sandbox.install()).ok);

  const report = await validateProject(sandbox, { typecheckTimeoutMs: 120_000, skipBuild: true });
  assert.equal(report.ok, false, 'a project importing a package it does not have does not work');
  assert.ok(report.problems.length, 'and the report says so with detail');

  const named = report.problems.find(problem => problem.missingPackage === 'zustand');
  assert.ok(named, `the missing dependency must be named: ${JSON.stringify(report.problems).slice(0, 500)}`);
  assert.equal(named!.file, 'src/App.tsx', 'and located');

  const repair = buildRepairInstruction(report);
  assert.match(repair, /zustand/);
  assert.match(repair, /Install them rather than rewriting the imports/);

  // Installing it is the fix, and the same check then passes — which is the
  // loop closing, not a report improving.
  const install = await sandbox.runCommand('npm', ['install', 'zustand@5.0.3', '--no-audit', '--no-fund'], { timeoutMs: 120_000, allowReview: true });
  assert.equal(install.code, 0, install.output.slice(-400));
  const after = await validateProject(sandbox, { typecheckTimeoutMs: 120_000, skipBuild: true });
  assert.equal(after.ok, true, `the repaired project must validate: ${JSON.stringify(after.problems).slice(0, 600)}`);

  console.log('sandbox validation tests passed');
} finally {
  await sandbox.destroy().catch(() => null);
  await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
}
