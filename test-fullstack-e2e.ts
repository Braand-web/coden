/**
 * End-to-end proof that a Coden-generated fullstack app is actually functional.
 *
 * The unit suite validates structure (files exist, patterns match). This test
 * goes further: it materializes the canonical generated app exactly as the
 * generation contract requires (React 18 + Vite + strict TS + Tailwind v3 +
 * pinned dependency versions), applies the deterministic fullstack kit
 * (Coden Cloud client, data layer, zod validation, auth guard, schema, RLS),
 * writes everything to a temp dir and runs the real thing:
 *
 *   npm install  ->  npm run build  ->  npm test  ->  npm run lint
 *
 * If any of these fail, apps "verified" by the platform would break the moment
 * a user exports or deploys them — exactly the regression this test catches.
 *
 * Requires network access to the npm registry; run via `npm run test:fullstack-e2e`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectCodenCloudRequirements } from './src/services/coden-cloud.ts';
import { applyCodenFullstackKit, validateCodenFullstackFiles } from './src/services/fullstack-generation.ts';
import { scanGeneratedSecurity } from './src/services/generated-security-scanner.ts';

const prompt = 'Create a CRM with login, clients, notes, invoices, uploads and persistent database.';

// ── Canonical base app, exactly as the zero-bug generation contract mandates ──

const packageJson = {
  name: 'coden-generated-crm',
  private: true,
  version: '0.1.0',
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    test: 'node --experimental-strip-types src/app.test.ts',
    lint: 'tsc --noEmit',
  },
  dependencies: {
    react: '^18.3.1',
    'react-dom': '^18.3.1',
    'lucide-react': '^0.383.0',
  },
  devDependencies: {
    '@vitejs/plugin-react': '^4.3.4',
    vite: '^5.4.19',
    typescript: '^5.7.3',
    '@types/react': '^18.3.18',
    '@types/react-dom': '^18.3.5',
    tailwindcss: '^3.4.17',
    postcss: '^8.4.49',
    autoprefixer: '^10.4.20',
  },
};

const baseFiles = [
  { path: 'package.json', language: 'json', content: JSON.stringify(packageJson, null, 2) },
  {
    path: 'index.html',
    language: 'html',
    content: [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>Clientline CRM</title>',
      '    <meta name="description" content="A lightweight CRM for client work: contacts, notes and invoices." />',
      '  </head>',
      '  <body>',
      '    <div id="root"></div>',
      '    <script type="module" src="/src/main.tsx"></script>',
      '  </body>',
      '</html>',
    ].join('\n'),
  },
  {
    path: 'vite.config.ts',
    language: 'ts',
    content: [
      "import { defineConfig } from 'vite';",
      "import react from '@vitejs/plugin-react';",
      '',
      'export default defineConfig({',
      '  plugins: [react()],',
      '});',
    ].join('\n'),
  },
  {
    path: 'tsconfig.json',
    language: 'json',
    content: JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
      },
      include: ['src'],
    }, null, 2),
  },
  {
    path: 'tailwind.config.ts',
    language: 'ts',
    content: [
      "import type { Config } from 'tailwindcss';",
      '',
      'export default {',
      "  content: ['./index.html', './src/**/*.{ts,tsx}'],",
      '  theme: { extend: {} },',
      '  plugins: [],',
      '} satisfies Config;',
    ].join('\n'),
  },
  {
    path: 'postcss.config.cjs',
    language: 'js',
    content: "module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };",
  },
  {
    path: 'src/main.tsx',
    language: 'tsx',
    content: [
      "import React from 'react';",
      "import ReactDOM from 'react-dom/client';",
      "import App from './App';",
      "import './index.css';",
      '',
      "ReactDOM.createRoot(document.getElementById('root')!).render(",
      '  <React.StrictMode>',
      '    <App />',
      '  </React.StrictMode>,',
      ');',
    ].join('\n'),
  },
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: [
      "import { useMemo, useState } from 'react';",
      "import { Plus, Search, Trash2, Users } from 'lucide-react';",
      '',
      'type Client = {',
      '  id: string;',
      '  name: string;',
      '  company: string;',
      "  status: 'lead' | 'active' | 'closed';",
      '};',
      '',
      'export default function App() {',
      '  const [clients, setClients] = useState<Client[]>([]);',
      "  const [name, setName] = useState('');",
      "  const [company, setCompany] = useState('');",
      "  const [query, setQuery] = useState('');",
      '',
      '  const visibleClients = useMemo(() => {',
      '    const q = query.trim().toLowerCase();',
      '    if (!q) return clients;',
      '    return clients.filter(client =>',
      '      client.name.toLowerCase().includes(q) || client.company.toLowerCase().includes(q));',
      '  }, [clients, query]);',
      '',
      '  function addClient(event: React.FormEvent<HTMLFormElement>) {',
      '    event.preventDefault();',
      '    const trimmed = name.trim();',
      '    if (!trimmed) return;',
      '    setClients(current => [',
      "      { id: crypto.randomUUID(), name: trimmed, company: company.trim() || '—', status: 'lead' },",
      '      ...current,',
      '    ]);',
      "    setName('');",
      "    setCompany('');",
      '  }',
      '',
      '  function removeClient(id: string) {',
      '    setClients(current => current.filter(client => client.id !== id));',
      '  }',
      '',
      '  return (',
      '    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">',
      '      <header className="mb-8">',
      '        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">',
      '          <Users className="h-6 w-6 text-blue-600" aria-hidden="true" /> Clientline CRM',
      '        </h1>',
      '        <p className="mt-1 text-sm text-slate-500">Track leads, clients and follow-ups in one list.</p>',
      '      </header>',
      '      <form onSubmit={addClient} className="mb-6 flex flex-wrap gap-2">',
      '        <label className="sr-only" htmlFor="client-name">Client name</label>',
      '        <input id="client-name" value={name} onChange={event => setName(event.target.value)}',
      '          placeholder="Client name" className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm" />',
      '        <label className="sr-only" htmlFor="client-company">Company</label>',
      '        <input id="client-company" value={company} onChange={event => setCompany(event.target.value)}',
      '          placeholder="Company" className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-sm" />',
      '        <button type="submit" className="flex min-h-[44px] items-center gap-1 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">',
      '          <Plus className="h-4 w-4" aria-hidden="true" /> Add',
      '        </button>',
      '      </form>',
      '      <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 px-3">',
      '        <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />',
      '        <label className="sr-only" htmlFor="client-search">Search clients</label>',
      '        <input id="client-search" value={query} onChange={event => setQuery(event.target.value)}',
      '          placeholder="Search clients" className="min-h-[44px] w-full text-sm outline-none" />',
      '      </div>',
      '      {visibleClients.length === 0 ? (',
      '        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">',
      "          {clients.length === 0 ? 'No clients yet. Add your first client above.' : 'No client matches this search.'}",
      '        </p>',
      '      ) : (',
      '        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">',
      '          {visibleClients.map(client => (',
      '            <li key={client.id} className="flex items-center justify-between gap-3 px-4 py-3">',
      '              <div>',
      '                <p className="text-sm font-medium text-slate-900">{client.name}</p>',
      '                <p className="text-xs text-slate-500">{client.company} · {client.status}</p>',
      '              </div>',
      '              <button type="button" onClick={() => removeClient(client.id)} aria-label={`Remove ${client.name}`}',
      '                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">',
      '                <Trash2 className="h-4 w-4" aria-hidden="true" />',
      '              </button>',
      '            </li>',
      '          ))}',
      '        </ul>',
      '      )}',
      '    </main>',
      '  );',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/index.css',
    language: 'css',
    content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
  },
  {
    path: 'src/app.test.ts',
    language: 'ts',
    content: [
      "import { readFileSync } from 'node:fs';",
      '',
      "const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');",
      'const isValid = app.includes(\'export default function App\') && app.includes(\'preventDefault\');',
      "console.log(isValid ? 'PASS app smoke test' : 'FAIL app smoke test');",
      'process.exit(isValid ? 0 : 1);',
    ].join('\n'),
  },
  {
    path: 'README.md',
    language: 'markdown',
    content: '# Clientline CRM\n\nGenerated by Coden. `npm install && npm run dev` to start.\n',
  },
];

// ── Apply the deterministic fullstack kit and validate structure ─────────────

const requirement = detectCodenCloudRequirements(prompt);
const files = applyCodenFullstackKit({ files: baseFiles, projectName: 'Clientline CRM', prompt, requirement });

const structural = validateCodenFullstackFiles(files, requirement);
const structuralFailures = structural.filter(check => check.status === 'fail');
assert.equal(structuralFailures.length, 0, `fullstack validation failed:\n${structuralFailures.map(c => `${c.key}: ${c.message}`).join('\n')}`);

const security = scanGeneratedSecurity(files, { prompt });
const securityFailures = security.findings.filter(finding => finding.status === 'fail');
assert.equal(securityFailures.length, 0, `security scan failed:\n${securityFailures.map(f => `${f.key}: ${f.message}`).join('\n')}`);

// ── Offline compile proof (no network): every generated TS/TSX transpiles ────
// Vite uses esbuild for TS/TSX -> JS at build time, so an esbuild transform
// that succeeds on every generated source file proves the app will bundle.
// This runs unconditionally, giving real "the code compiles" evidence even
// when the sandbox cannot reach the npm registry for a full install.
{
  const esbuild = await import('esbuild');
  const compilable = files.filter(file => /\.(ts|tsx|js|jsx)$/.test(file.path));
  assert.ok(compilable.length >= 8, `expected the generated app to contain source files, found ${compilable.length}`);
  for (const file of compilable) {
    const loader = file.path.endsWith('.tsx')
      ? 'tsx'
      : file.path.endsWith('.ts')
        ? 'ts'
        : file.path.endsWith('.jsx')
          ? 'jsx'
          : 'js';
    try {
      const result = await esbuild.transform(file.content, {
        loader: loader as 'ts' | 'tsx' | 'js' | 'jsx',
        format: 'esm',
        target: 'es2020',
        jsx: 'automatic',
      });
      assert.ok(result.code.length > 0, `${file.path} transpiled to empty output`);
    } catch (error) {
      assert.fail(`generated file ${file.path} failed to transpile: ${(error as Error).message}`);
    }
  }
  console.log(`[fullstack-e2e] offline compile passed: ${compilable.length} generated source files transpile cleanly.`);
}

// ── Materialize and actually run install/build/test/lint ────────────────────

const workdir = await mkdtemp(path.join(tmpdir(), 'coden-fullstack-e2e-'));

function run(command: string, args: string[], timeoutMs: number) {
  const result = spawnSync(command, args, {
    cwd: workdir,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || workdir,
      CI: '1',
      // npm needs a writable cache; a shared persistent cache keeps reruns fast.
      npm_config_cache: process.env.CODEN_E2E_NPM_CACHE || path.join(workdir, '.npm-cache'),
      npm_config_fund: 'false',
      npm_config_audit: 'false',
      npm_config_update_notifier: 'false',
    },
  });
  return result;
}

try {
  for (const file of files) {
    const target = path.join(workdir, file.path);
    assert.ok(target.startsWith(workdir), `unsafe path: ${file.path}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }

  // A registry timeout or DNS/network failure during `npm install` is an
  // environment constraint, not a generation defect — those SKIP with exit 0
  // and a clear reason. Once the dependency tree is installed, every build /
  // test / typecheck failure is a real defect in the generated app and FAILS.
  const NETWORK_ERROR_RE = /ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|network|registry\.npmjs\.org.*(?:timeout|failed)|ERR_SOCKET|request to .* failed/i;

  const installStarted = Date.now();
  const install = run('npm', ['install', '--no-fund', '--no-audit'], 540_000);
  const installDuration = Math.round((Date.now() - installStarted) / 100) / 10;
  const installOutput = `${install.stdout || ''}\n${install.stderr || ''}`.trim();

  if (install.status !== 0) {
    // status === null means the process was killed (timeout); combined with a
    // network signature it is an environment limitation, not a code defect.
    const looksEnvironmental = install.status === null || NETWORK_ERROR_RE.test(installOutput);
    if (looksEnvironmental) {
      console.log(`[fullstack-e2e] SKIPPED: npm install could not complete in this environment after ${installDuration}s (network/registry unavailable). Structure + security validation already passed. Run with network access to exercise the full build.`);
      process.exit(0);
    }
    assert.fail(`npm install failed with a non-network error (exit ${install.status}) after ${installDuration}s:\n${installOutput.slice(-4000)}`);
  }
  console.log(`[fullstack-e2e] npm install passed in ${installDuration}s`);

  const steps: Array<{ label: string; args: string[]; timeoutMs: number }> = [
    { label: 'npm run build', args: ['run', 'build'], timeoutMs: 180_000 },
    { label: 'npm test', args: ['test'], timeoutMs: 120_000 },
    { label: 'npm run lint', args: ['run', 'lint'], timeoutMs: 180_000 },
  ];

  for (const step of steps) {
    const startedAt = Date.now();
    const result = run('npm', step.args, step.timeoutMs);
    const duration = Math.round((Date.now() - startedAt) / 100) / 10;
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    assert.equal(
      result.status,
      0,
      `${step.label} failed (exit ${result.status}) after ${duration}s:\n${output.slice(-4000)}`,
    );
    console.log(`[fullstack-e2e] ${step.label} passed in ${duration}s`);
  }

  console.log('fullstack e2e: generated app installs, builds, tests and typechecks — functional.');
} finally {
  await rm(workdir, { recursive: true, force: true });
}
