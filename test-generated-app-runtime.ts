import assert from 'node:assert/strict';
import {
  createGeneratedAppManifest,
  manifestFile,
  resolveGeneratedAppProfile,
  validateGeneratedAppManifest,
} from './src/services/generated-app-runtime.ts';

const staticFiles = [
  { path: 'package.json', content: JSON.stringify({ dependencies: { react: '^19.0.0' } }) },
  { path: 'index.html', content: '<div id="root"></div>' },
];

assert.equal(resolveGeneratedAppProfile({ files: staticFiles }), 'vite-static');
const staticManifest = createGeneratedAppManifest({ files: staticFiles });
assert.equal(staticManifest.runtime, 'static-assets');
assert.equal(staticManifest.backend, 'none');
assert.deepEqual(validateGeneratedAppManifest(staticManifest), []);

const legacyFullstackFiles = [
  { path: 'package.json', content: JSON.stringify({ dependencies: { '@supabase/supabase-js': '^2.0.0' } }) },
  { path: 'src/lib/appData.ts', content: 'export const list = () => supabase.from("items");' },
];

const legacyManifest = createGeneratedAppManifest({
  files: legacyFullstackFiles,
  requirement: { needs_database: true },
});
assert.equal(legacyManifest.profile, 'legacy-vite-fullstack');
assert.equal(legacyManifest.backend, 'coden-cloud-supabase');
assert.equal(legacyManifest.capabilities.database, true);
assert.ok(legacyManifest.requiredPublicEnv.length > 0);

const nodeFullstackFiles = [
  {
    path: 'package.json',
    content: JSON.stringify({
      scripts: { dev: 'vite', 'dev:server': 'tsx server/index.ts', build: 'vite build && tsc -p tsconfig.server.json', start: 'node dist-server/index.js' },
      dependencies: { react: '^19.0.0', vite: '^7.0.0', express: '^5.0.0' },
    }),
  },
  { path: 'server/index.ts', content: 'app.get("/api/health", handler)' },
  { path: 'vite.config.ts', content: 'export default { server: { proxy: { "/api": "http://localhost:3001" } } }' },
];
const nodeManifest = createGeneratedAppManifest({ files: nodeFullstackFiles });
assert.equal(nodeManifest.profile, 'node-fullstack');
assert.equal(nodeManifest.runtime, 'node-server');
assert.equal(nodeManifest.backend, 'node-api');
assert.equal(nodeManifest.requiredPublicEnv.length, 0);
assert.deepEqual(validateGeneratedAppManifest(nodeManifest), []);

const tanstackFiles = [
  {
    path: 'package.json',
    content: JSON.stringify({
      dependencies: {
        '@tanstack/react-start': '^1.0.0-rc',
        '@tanstack/react-router': '^1.0.0-rc',
      },
    }),
  },
  { path: 'src/routes/__root.tsx', content: 'export const Route = createRootRoute()' },
  { path: 'src/server.ts', content: 'export default createServerEntry({ fetch() {} })' },
];

const tanstackManifest = createGeneratedAppManifest({
  files: tanstackFiles,
  requirement: { needs_database: true, needs_auth: true, needs_edge_functions: true },
});
assert.equal(tanstackManifest.profile, 'tanstack-fullstack');
assert.equal(tanstackManifest.framework, 'tanstack-start');
assert.equal(tanstackManifest.runtime, 'cloudflare-workers');
assert.equal(tanstackManifest.capabilities.ssr, true);
assert.equal(tanstackManifest.capabilities.serverFunctions, true);
assert.deepEqual(validateGeneratedAppManifest(tanstackManifest), []);

const unsafeOutputManifest = {
  ...staticManifest,
  outputDirectory: '../outside-project',
};
assert.ok(
  validateGeneratedAppManifest(unsafeOutputManifest).some(error => /outputDirectory|Output directory/i.test(error)),
  'Manifest validation must reject build output paths outside the project.',
);

// A managed backend is always reached from the browser with the same public
// Coden Cloud config, so declaring `coden-cloud-supabase` without that config
// makes the manifest invalid and generation throws. These signals each select a
// managed backend on their own, and every one of them used to produce an empty
// requiredPublicEnv -- a single word like "Upload" in button copy was enough to
// make an otherwise fine app impossible to generate.
for (const [label, markup] of [
  ['storage', '<button>Upload a photo</button>'],
  ['payments', '<p>Subscription plans</p>'],
  ['invoicing', '<p>Invoice history</p>'],
  ['checkout', '<button>Checkout</button>'],
  ['realtime', '<p>realtime updates</p>'],
] as const) {
  const manifest = createGeneratedAppManifest({
    files: [
      { path: 'package.json', content: JSON.stringify({ dependencies: { react: '^19.0.0' } }) },
      { path: 'index.html', content: '<div id="root"></div>' },
      { path: 'src/App.tsx', content: `export default function App(){ return <main><h1>App</h1>${markup}</main>; }` },
    ],
  });
  assert.equal(manifest.backend, 'coden-cloud-supabase', `${label} must select the managed backend`);
  assert.ok(
    manifest.requiredPublicEnv.some(env => env.name.includes('SUPABASE')),
    `${label} backend must declare its public runtime configuration`,
  );
  assert.deepEqual(validateGeneratedAppManifest(manifest), [], `${label} manifest must be valid`);
}

// The invariant in the other direction: an app with no backend must not be made
// to carry backend configuration it never uses.
assert.equal(staticManifest.requiredPublicEnv.length, 0);

// The tanstack-fullstack profile commits the app to the Workers runtime and
// makes Router, Query and Wrangler mandatory. A stray mention of createServerFn
// in a comment used to select it and then fail the whole generation, so the
// evidence must be a real dependency or a real import.
const incidentalServerFnFiles = [
  { path: 'package.json', content: JSON.stringify({ dependencies: { react: '^19.0.0' } }) },
  { path: 'index.html', content: '<div id="root"></div>' },
  { path: 'src/App.tsx', content: '// createServerFn could be used later\nexport default function App(){ return <h1>Hi</h1>; }' },
];
assert.equal(resolveGeneratedAppProfile({ files: incidentalServerFnFiles }), 'vite-static');
assert.doesNotThrow(() => manifestFile({ files: incidentalServerFnFiles }));

// A real TanStack Start app must still be recognised, whether the evidence is
// the declared dependency or the import. Misclassifying it would strip its
// server runtime on publish, which cloudflare-hosting-policy forbids.
assert.equal(resolveGeneratedAppProfile({ files: tanstackFiles }), 'tanstack-fullstack');
const tanstackByImportOnly = [
  {
    path: 'package.json',
    content: JSON.stringify({ dependencies: { '@tanstack/react-router': '^1.0.0-rc' } }),
  },
  { path: 'src/routes/__root.tsx', content: 'export const Route = createRootRoute()' },
  {
    path: 'src/server.ts',
    content: "import { createServerFn } from '@tanstack/react-start';\nexport const load = createServerFn();",
  },
];
assert.equal(resolveGeneratedAppProfile({ files: tanstackByImportOnly }), 'tanstack-fullstack');

console.log('test-generated-app-runtime passed');
