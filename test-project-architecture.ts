import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describeProjectArchitecture, renderProjectArchitecture } from './src/services/project-architecture.ts';

/**
 * Shaped on the real QuickCalc project from production: a TanStack app with a
 * file router, a Supabase migration, and runtime configuration read through
 * import.meta.env.
 */
const quickcalc = [
  { path: 'package.json', content: JSON.stringify({
    dependencies: {
      react: '^18.3.1', 'react-dom': '^18.3.1',
      '@tanstack/react-start': '1.168.49', '@tanstack/react-router': '1.170.32',
      '@tanstack/react-query': '5.102.2', '@supabase/supabase-js': '2.106.0', zod: '4.4.3',
    },
    devDependencies: { vite: '7.3.6', typescript: 'latest' },
  }) },
  { path: 'index.html', content: '<!doctype html><html><body><div id="root"></div></body></html>' },
  { path: 'src/App.tsx', content: 'export default function App(){ return <h1>QuickCalc</h1>; }', updated_at: '2026-09-02T06:07:00Z' },
  { path: 'src/routes/__root.tsx', content: 'export const Route = createRootRoute();' },
  { path: 'src/routes/index.tsx', content: "createFileRoute('/')({ component: App });" },
  { path: 'src/routes/settings.tsx', content: "createFileRoute('/settings')({});", updated_at: '2026-09-02T06:08:00Z' },
  { path: 'src/lib/codenCloud.ts', content: "const url = import.meta.env.VITE_SUPABASE_URL; const key = import.meta.env.VITE_SUPABASE_ANON_KEY;", updated_at: '2026-09-02T06:05:00Z' },
  { path: 'supabase/migrations/0001_coden_fullstack.sql', content: 'create table if not exists public.app_records (id uuid);\ncreate table public.profiles (id uuid);' },
];

// The map answers what does not depend on which file the user is asking about.
{
  const architecture = describeProjectArchitecture(quickcalc);
  assert.equal(architecture.framework, 'TanStack Start (React, SSR)', 'the deciding dependency names the stack');
  assert.ok(architecture.dependencies.includes('@supabase/supabase-js'));
  assert.ok(!architecture.dependencies.includes('vite'), 'devDependencies are not what the app runs on');
  assert.deepEqual(architecture.routes, ['/', '/settings'], 'the file router defines the routes, minus __root');
  assert.deepEqual(architecture.tables, ['app_records', 'profiles']);
  assert.deepEqual(architecture.env, ['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL']);
  assert.equal(architecture.fileCount, 8);
}

// Recently changed files come from the timestamps on the records. The context
// selector claimed to boost these and only measured file size instead.
{
  const architecture = describeProjectArchitecture(quickcalc);
  assert.deepEqual(architecture.recentFiles, ['src/routes/settings.tsx', 'src/App.tsx', 'src/lib/codenCloud.ts']);
}

// The rendered block is terse enough to ride along with every request.
{
  const rendered = renderProjectArchitecture(quickcalc);
  assert.ok(rendered.startsWith('Project map (8 files):'));
  assert.ok(rendered.includes('- Stack: TanStack Start'));
  assert.ok(rendered.includes('- Routes: /, /settings'));
  assert.ok(rendered.includes('- Tables: app_records, profiles'));
  assert.ok(rendered.includes('- Runtime config: VITE_SUPABASE_ANON_KEY'));
  assert.ok(rendered.includes('- Last changed: src/routes/settings.tsx'));
  assert.ok(rendered.length < 900, `the map must stay cheap, got ${rendered.length} chars`);
}

// A section with nothing to say is omitted. "Routes: none" reads as a fact
// about the app when it is really a fact about our detection.
{
  const rendered = renderProjectArchitecture([
    { path: 'index.html', content: '<!doctype html><html><body><h1>Hello</h1></body></html>' },
    { path: 'style.css', content: 'body { color: red; }' },
  ]);
  assert.ok(rendered.includes('Project map (2 files)'));
  assert.ok(rendered.includes('- Stack: Static HTML'));
  assert.ok(!/Routes:|Tables:|Runtime config:|Dependencies:/.test(rendered), 'nothing detected means nothing claimed');
}

// Routes declared in JSX are found when there is no file router.
{
  const architecture = describeProjectArchitecture([
    { path: 'package.json', content: JSON.stringify({ dependencies: { react: '18', 'react-router-dom': '6' } }) },
    { path: 'src/App.tsx', content: '<Route path="/" element={<Home/>}/><Route path="/about" element={<About/>}/>' },
  ]);
  assert.equal(architecture.framework, 'React + React Router');
  assert.deepEqual(architecture.routes, ['/', '/about']);
}

// Malformed input must not take down a generation.
for (const input of [[], null, undefined, [{ path: 'package.json', content: '{ not json' }]] as any[]) {
  assert.doesNotThrow(() => renderProjectArchitecture(input));
}
assert.equal(renderProjectArchitecture([]), '', 'an empty project has no map');

// Wiring: the map must reach the model on both context paths, or it falls out
// of view exactly when the selector drops the file it describes.
const server = fs.readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const contextStart = server.indexOf('function buildExistingFilesContextForGeneration');
const contextBody = server.slice(contextStart, contextStart + 2400);
assert.ok(/renderProjectArchitecture\(files\)/.test(contextBody), 'the map must be built from the project files');
// Both context paths, not just one: the selected-context path a real project
// takes, and the small-project fallback under five files.
assert.ok(/return withMap\(result\.contextText\)/.test(contextBody), 'the selected-context path must carry the map');
assert.ok(/return withMap\(chunks\.join/.test(contextBody), 'the small-project path must carry the map');

console.log('project architecture tests passed');
