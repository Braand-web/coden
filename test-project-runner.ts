import assert from 'node:assert/strict';
import {
  HybridProjectRunner,
  isVerificationCapabilityUnavailable,
  runnerChecksToVerificationChecks,
} from './src/services/project-runner.ts';

const goodHtml = '<!doctype html><html><head><title>Demo</title><meta name="description" content="Demo app"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script><main><h1>Demo</h1><button>Save</button></main></body></html>';
// This unit fixture audits a compiled HTML document, not unserved TSX sources.
const compiledHtml = goodHtml
  .replace('<div id="root"></div><script type="module" src="/src/main.tsx"></script>', '')
  .replace('</main>', '<p>Ready to save a complete demonstration record.</p></main>');

{
  const runner = new HybridProjectRunner({ executeScripts: false });
  const result = await runner.run({
    runId: 'run_good',
    projectId: 'project_good',
    previewHtml: compiledHtml,
    files: [
      { path: 'index.html', language: 'html', content: goodHtml },
      { path: 'package.json', language: 'json', content: JSON.stringify({ scripts: { build: 'vite build', lint: 'tsc --noEmit' } }) },
      { path: 'src/main.tsx', language: 'tsx', content: 'import App from "./App"; import "./index.css"; console.log(App);' },
      {
        path: 'src/App.tsx',
        language: 'tsx',
        content: 'import { useState } from "react"; export default function App(){ const [saved,setSaved]=useState(false); return <main><h1>Demo</h1><form onSubmit={(e)=>{e.preventDefault(); setSaved(true)}}><input required aria-label="Name" /><button onClick={()=>setSaved(true)}>Save</button></form>{saved ? <p>success saved</p> : <p>empty loading ready</p>}</main> }',
      },
      {
        path: 'src/index.css',
        language: 'css',
        content: ':root{--bg:#fff;--text:#111}button:focus-visible{outline:2px solid #111}@media(max-width:700px){main{display:block}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}',
      },
    ],
  });

  assert.equal(result.status, 'passed', JSON.stringify(result.checks.filter(check => check.status === 'failed')));
  assert.ok(result.checks.some(check => check.check_type === 'script_build_safe' && check.status === 'passed'));
  assert.ok(result.checks.some(check => check.check_type === 'script_build_exec' && check.status === 'skipped'));
  assert.ok(result.checks.some(check => check.check_type === 'vite_main_present' && check.status === 'passed'));
  assert.ok(result.checks.some(check => check.check_type === 'control_handlers' && check.status === 'passed'));
  assert.ok(result.checks.some(check => check.check_type === 'production_frontend' && check.status === 'passed'));
  assert.ok(result.checks.some(check => check.check_type === 'production_readiness_score'));
  assert.ok(result.checks.some(check => check.check_type === 'technical_build_score' && check.status === 'passed'));
}

{
  const runner = new HybridProjectRunner({ executeScripts: false });
  const result = await runner.run({
    runId: 'run_local_express_fullstack',
    projectId: 'project_local_express_fullstack',
    previewHtml: compiledHtml,
    prompt: 'Create a full-stack Vite React app with an Express API and in-memory preview persistence, without external services.',
    files: [
      { path: 'index.html', content: goodHtml },
      {
        path: 'package.json',
        content: JSON.stringify({
          scripts: {
            dev: 'vite',
            'dev:server': 'tsx server/index.ts',
            build: 'vite build && tsc -p tsconfig.server.json',
            start: 'node dist-server/index.js',
            test: 'tsx --test server/**/*.test.ts && node --experimental-strip-types src/app.test.ts',
            lint: 'tsc --noEmit',
          },
          dependencies: { react: '^18.3.1', express: '^4.21.2' },
          devDependencies: { vite: '^7.3.6', tsx: '^4.19.2' },
        }),
      },
      { path: 'src/main.tsx', content: 'import App from "./App"; import "./index.css"; console.log(App);' },
      { path: 'src/App.tsx', content: 'export default function App(){ return <main><h1>Tasks</h1><form><input required /><button onClick={() => fetch("/api/tasks")}>Add</button></form><p>loading empty success error filter</p></main> }' },
      { path: 'src/app.test.ts', content: 'console.log("pass")' },
      { path: 'src/index.css', content: '@media(max-width:700px){main{display:block}} button:focus-visible{outline:2px solid}' },
      { path: 'vite.config.ts', content: 'export default { server: { proxy: { "/api": "http://localhost:3001" } } };' },
      { path: 'server/index.ts', content: 'import express from "express"; import { createTaskStore } from "./taskStore.js"; const app=express(); app.use(express.json()); app.get("/api/health",(_req,res)=>res.json({status:"ok"})); app.get("/api/tasks",(_req,res)=>res.json(createTaskStore().getAll())); app.post("/api/tasks",(request,response)=>{ const title=String(request.body?.title || "").trim(); if(title.length < 3) return response.status(400).json({error:"required"}); return response.status(201).json({title}); });' },
      { path: 'server/taskStore.ts', content: 'export function createTaskStore(){ return { getAll: () => [] }; }' },
      { path: 'server/taskStore.test.ts', content: 'import { test } from "node:test"; test("store", () => undefined);' },
      { path: 'tsconfig.server.json', content: JSON.stringify({ compilerOptions: { outDir: 'dist-server' }, include: ['server'] }) },
    ],
  });

  assert.ok(!result.checks.some(check => check.check_type === 'local_imports_resolve' && check.status === 'failed'));
  assert.ok(result.checks.some(check => check.check_type === 'script_test_safe' && check.status === 'passed'));
  assert.ok(result.checks.some(check => check.check_type === 'production_backend_contract' && check.status === 'passed'));
  assert.ok(result.checks.some(check => check.check_type === 'production_node_runtime' && check.status === 'passed'));
  assert.ok(result.checks.some(check => check.check_type === 'production_fullstack_preview' && check.status === 'passed'));
  assert.ok(!result.checks.some(check => check.check_type === 'production_database_security' && check.status === 'failed'));
  assert.ok(!result.checks.some(check => check.check_type === 'production_auth_guard' && check.status === 'failed'));
}

{
  const runner = new HybridProjectRunner({ executeScripts: false });
  const result = await runner.run({
    runId: 'run_tailwind_responsive',
    projectId: 'project_tailwind_responsive',
    previewHtml: compiledHtml,
    files: [
      { path: 'index.html', language: 'html', content: goodHtml },
      { path: 'package.json', language: 'json', content: JSON.stringify({ scripts: { build: 'vite build' } }) },
      { path: 'src/main.tsx', language: 'tsx', content: 'import App from "./App"; import "./index.css"; console.log(App);' },
      {
        path: 'src/App.tsx',
        language: 'tsx',
        content: 'import { useState } from "react"; export default function App(){ const [saved,setSaved]=useState(false); return <main className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><h1>Responsive workspace</h1><button onClick={()=>setSaved(true)}>Save</button><p>{saved ? "success saved" : "empty ready"}</p></main> }',
      },
      { path: 'src/index.css', language: 'css', content: ':root{--bg:#fff;--text:#111}button:focus-visible{outline:2px solid #111}' },
    ],
  });

  assert.ok(result.checks.some(check => check.check_type === 'production_responsive' && check.status === 'passed'));
}

{
  const runner = new HybridProjectRunner({ executeScripts: false });
  const stalePreview = '<!doctype html><html><body><main><h1>Old preview</h1></main></body></html>';
  const result = await runner.run({
    runId: 'run_source_index_over_preview',
    projectId: 'project_source_index_over_preview',
    previewHtml: stalePreview,
    files: [
      { path: 'index.html', language: 'html', content: goodHtml },
      { path: 'package.json', language: 'json', content: JSON.stringify({ scripts: { build: 'vite build' } }) },
      { path: 'src/main.tsx', language: 'tsx', content: 'import App from "./App"; console.log(App);' },
      { path: 'src/App.tsx', language: 'tsx', content: 'export default function App(){ return <main><h1>Todo</h1><button onClick={() => undefined}>Add</button><p>empty success loading</p></main> }' },
    ],
  });

  assert.ok(result.checks.some(check => check.check_type === 'vite_main_script' && check.status === 'passed'));
  assert.ok(result.checks.some(check => check.check_type === 'vite_root_mount' && check.status === 'passed'));
}

{
  const runner = new HybridProjectRunner({ executeScripts: false });
  const result = await runner.run({
    runId: 'run_fake_backend',
    projectId: 'project_fake_backend',
    previewHtml: compiledHtml,
    prompt: 'create a private CRM with database customers and authenticated client records',
    files: [
      { path: 'index.html', language: 'html', content: goodHtml },
      { path: 'package.json', language: 'json', content: JSON.stringify({ scripts: { build: 'vite build' } }) },
      { path: 'src/main.tsx', language: 'tsx', content: 'import App from "./App"; console.log(App);' },
      {
        path: 'src/App.tsx',
        language: 'tsx',
        content: 'export default function App(){ localStorage.setItem("customers", "[]"); return <main><h1>CRM customers</h1><button onClick={() => localStorage.setItem("customers", "[]")}>Save customer</button></main> }',
      },
    ],
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.checks.some(check => check.check_type === 'production_backend_contract' && check.status === 'failed'));
  assert.ok(result.checks.some(check => check.check_type === 'production_no_fake_localstorage' && check.status === 'failed'));
}

{
  const runner = new HybridProjectRunner();
  const result = await runner.run({
    runId: 'run_bad',
    projectId: 'project_bad',
    previewHtml: '',
    files: [
      { path: '../.env', content: 'OPENROUTER_API_KEY=sk-test-secret' },
      { path: 'package.json', content: JSON.stringify({ scripts: { build: 'rm -rf /' } }) },
      { path: 'data.json', content: '{broken' },
    ],
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.checks.some(check => check.check_type === 'safe_path' && check.status === 'failed'));
  assert.ok(result.checks.some(check => check.check_type === 'script_build_safe' && check.status === 'failed'));
  assert.ok(result.checks.some(check => check.check_type === 'json_parse' && check.status === 'failed'));
  assert.ok(result.checks.some(check => check.check_type === 'technical_build_score' && check.status === 'failed'));
  const verification = runnerChecksToVerificationChecks(result.checks);
  assert.ok(verification.some(check => check.key === 'runner_safe_path' && check.status === 'fail'));
}

// Only a missing verification capability may block a release. Advisory checks
// that merely came back inconclusive must not, or a working app is
// unpublishable for lacking a meta description or a lint script.
{
  // The capability is named by check_type, not by the prose message.
  assert.equal(
    isVerificationCapabilityUnavailable({
      check_type: 'browser_runner_disabled',
      message: 'Browser interaction runner is disabled; static visual and functional checks were used.',
    }),
    true,
  );
  assert.equal(
    isVerificationCapabilityUnavailable({
      check_type: 'browser_runner_unavailable',
      message: 'Browser runner is enabled but Playwright is not installed in this environment.',
    }),
    true,
  );
  for (const advisory of [
    { check_type: 'script_lint', message: 'No lint script present.' },
    { check_type: 'script_build_exec', message: 'build execution skipped by runner policy.' },
    { check_type: 'seo_description', message: 'Preview is missing a meta description.' },
    { check_type: 'list_tools', message: 'List-oriented apps should include search, filters, sorting, or status controls.' },
    { check_type: 'package_scripts', message: 'Script checks skipped for this legacy static snapshot.' },
    { check_type: 'a11y_h1', message: 'Preview is missing a clear H1.' },
  ]) {
    assert.equal(isVerificationCapabilityUnavailable(advisory), false, advisory.check_type);
  }
}

// A Vite shell carries no rendered copy, so content checks must read the
// rendered preview rather than reporting an H1 the app clearly renders.
{
  const runner = new HybridProjectRunner({ executeScripts: false });
  const result = await runner.run({
    runId: 'run_shell',
    projectId: 'project_shell',
    previewHtml: '<!doctype html><html><head><title>Demo</title><meta name="description" content="Demo app"></head><body><main><h1>Demo</h1><button>Save</button></main></body></html>',
    files: [
      { path: 'index.html', content: '<!doctype html><html><head><title>Demo</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' },
      { path: 'src/main.tsx', content: "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);\n" },
      { path: 'src/App.tsx', content: 'export default function App(){ return <main><h1>Demo</h1><button onClick={() => {}}>Save</button></main>; }' },
    ],
  });
  assert.ok(!result.checks.some(check => check.check_type === 'a11y_h1'), 'rendered H1 must not be reported missing');
  assert.ok(!result.checks.some(check => check.check_type === 'seo_description'), 'rendered meta description must not be reported missing');
}

console.log('test-project-runner passed');
