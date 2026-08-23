import assert from 'node:assert/strict';
import {
  createGeneratedAppManifest,
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

console.log('test-generated-app-runtime passed');
