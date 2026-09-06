import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const builder = fs.readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');

const canonicalPublishRoutes = server.match(/app\.post\('\/api\/projects\/:id\/publish', requireAuth, publishCloudflareProjectForRequest\);/g) || [];
const canonicalDeployRoutes = server.match(/app\.post\('\/api\/projects\/:id\/deploy', requireAuth, publishCloudflareProjectForRequest\);/g) || [];

assert.equal(canonicalPublishRoutes.length, 1, 'Publish must have one canonical Cloudflare route.');
assert.equal(canonicalDeployRoutes.length, 1, 'Deploy must have one canonical Cloudflare route.');
assert.doesNotMatch(server, /app\.post\('\/api\/projects\/:id\/(?:publish|deploy)', publishProjectSnapshot\)/, 'Legacy Vercel publish routes must stay unregistered.');
assert.match(server, /if \(!publishStatus\.can_publish\)/, 'Publishing must be gated by verified publish status.');
assert.match(server, /PUBLISH_CONFIRMATION_REQUIRED/, 'Publishing must require explicit confirmation.');
assert.match(server, /verifyProjectPreviewWithRealBuild/, 'Preview verification must use the real-build verifier.');
assert.match(server, /runViteBuild: true/, 'Preview and publication verification must execute a real project build.');
assert.match(server, /runtime: contract\.manifest\.runtime/, 'The generated manifest runtime must drive the Cloudflare deployment target.');
assert.match(server, /verifyCloudflareDeployment\(result, publicRoutes\)/, 'A published deployment must pass real HTTP checks before success.');
assert.match(builder, /data-publish-action="confirm-publish"/, 'Publish confirmation must be rendered inside the product UI.');
assert.doesNotMatch(builder, /window\.confirm\(`Confirmer :/, 'The publish flow must not fall back to a native browser confirmation.');
assert.match(builder, /idempotency-key/, 'Builder must attach an idempotency key to publish requests.');
assert.match(builder, /confirmed: true, idempotency_key: idempotencyKey/, 'Builder must send explicit publish confirmation.');
assert.match(server, /const activePublishOperations = new Map/, 'The server must reject concurrent publishes for the same project.');
assert.match(server, /PUBLISH_IN_PROGRESS/, 'Concurrent publish rejection must have a stable diagnostic code.');
assert.match(server, /readGeneratedRuntimeContract\(project, context\.files\)/, 'The exact publish snapshot must drive the manifest, build and artifact hash.');
assert.match(server, /rollbackCloudflareWorkerDeployment\(workerName, String\(target\.provider_deployment_id\)\)/, 'Rollback must restore the provider deployment, not only copy a database row.');
assert.match(server, /provider_deployment_id: providerRollback\.deploymentId/, 'Rollback persistence must reference the new Cloudflare deployment.');
assert.doesNotMatch(
  server,
  /await client\.from\([^\n]+\)\.(?:upsert|insert|update|delete)\([^\n]*\)\.catch/,
  'Supabase query builders are PromiseLike and must not be chained directly with catch().',
);
assert.match(server, /requireDatabaseResult\(client\.from\('project_runtime_profiles'\)\.upsert/, 'Runtime persistence must handle PromiseLike builders and resolved SQL errors.');
assert.match(server, /publishLockToken = requestId/, 'Client idempotency keys cannot confer ownership of another request lock.');

console.log('publish and preview verification gate tests passed');
