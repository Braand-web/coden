import assert from 'node:assert/strict';
import { HybridProjectRunner, runnerChecksToVerificationChecks } from './src/services/project-runner.ts';

const goodHtml = '<!doctype html><html><head><title>Demo</title><meta name="description" content="Demo app"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script><main><h1>Demo</h1><button>Save</button></main></body></html>';

{
  const runner = new HybridProjectRunner({ executeScripts: false });
  const result = await runner.run({
    runId: 'run_good',
    projectId: 'project_good',
    previewHtml: goodHtml,
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

  assert.equal(result.status, 'passed');
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
    runId: 'run_tailwind_responsive',
    projectId: 'project_tailwind_responsive',
    previewHtml: goodHtml,
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
    previewHtml: goodHtml,
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

console.log('test-project-runner passed');
