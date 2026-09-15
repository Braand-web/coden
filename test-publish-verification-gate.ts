import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const builder = fs.readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');
const publisher = fs.readFileSync(new URL('./src/services/publish-vercel.ts', import.meta.url), 'utf8');

const canonicalPublishRoutes = server.match(/app\.post\('\/api\/projects\/:id\/publish', requireAuth, publishVercelProjectForRequest\);/g) || [];
const canonicalDeployRoutes = server.match(/app\.post\('\/api\/projects\/:id\/deploy', requireAuth, publishVercelProjectForRequest\);/g) || [];

assert.equal(canonicalPublishRoutes.length, 1, 'Publish must have one canonical Vercel route.');
assert.equal(canonicalDeployRoutes.length, 1, 'Deploy must have one canonical Vercel route.');
assert.doesNotMatch(server, /publishCloudflareProjectForRequest/, 'Generated apps must not re-enter the retired Cloudflare publisher.');
assert.match(server, /if \(!publishStatus\.can_publish\)/, 'Publishing must be gated by verified publish status.');
assert.match(server, /PUBLISH_CONFIRMATION_REQUIRED/, 'Publishing must require explicit confirmation.');
assert.match(server, /verifyProjectPreviewWithRealBuild/, 'Preview verification must use the real-build verifier.');
assert.match(server, /runViteBuild: true/, 'Preview and publication verification must execute a real project build.');
assert.match(server, /runtime: contract\.manifest\.runtime/, 'The manifest runtime must drive Vercel deployment.');
assert.match(server, /verifyVercelDeployment\(result, publicRoutes\)/, 'A deployment must pass real HTTP checks before success.');
assert.match(server, /sourceDir: contract\.manifest\.runtime === 'static-assets' \? undefined : workDir/, 'Static apps must use prebuilt output while server apps send source.');
assert.match(server, /const publicUrl = publishedDeployment/, 'No public URL may be exposed before a ready deployment exists.');
assert.match(server, /status: 'failed',[\s\S]{0,500}diagnostic_code: diagnostic\.diagnostic_code/, 'Failed attempts must remain observable.');
assert.match(publisher, /apiUrl\('\/v2\/files'\)/, 'Files must be uploaded before deployment creation.');
assert.match(publisher, /'x-vercel-digest': file\.sha/, 'Every upload must use its immutable SHA digest.');
assert.match(publisher, /files: files\.map\(\(\{ file, sha, size \}\)/, 'Deployment creation must use SHA references.');
assert.match(builder, /data-publish-action="confirm-publish"/, 'Publish confirmation must be rendered inside the UI.');
assert.doesNotMatch(builder, /window\.confirm\(`Confirmer :/, 'The publish flow must not use a native browser confirmation.');
assert.match(builder, /idempotency-key/, 'Builder must attach an idempotency key.');
assert.match(builder, /confirmed: true, idempotency_key: idempotencyKey/, 'Builder must send explicit confirmation.');
assert.match(builder, /version sur Vercel/, 'Progress UI must name the actual provider.');
assert.match(server, /const activePublishOperations = new Map/, 'Concurrent publishes must be rejected.');
assert.match(server, /PUBLISH_IN_PROGRESS/, 'Concurrent rejection must have a stable code.');
assert.match(server, /readGeneratedRuntimeContract\(project, context\.files\)/, 'The exact snapshot must drive build and artifact hash.');
assert.match(server, /promoteVercelDeployment\(projectName, String\(target\.provider_deployment_id\)\)/, 'Rollback must promote the prior Vercel deployment.');
assert.doesNotMatch(
  server,
  /await client\.from\([^\n]+\)\.(?:upsert|insert|update|delete)\([^\n]*\)\.catch/,
  'Supabase query builders are PromiseLike and must not be chained directly with catch().',
);
assert.match(server, /requireDatabaseResult\(client\.from\('project_runtime_profiles'\)\.upsert/, 'Runtime persistence must handle resolved Supabase errors.');
assert.match(server, /publishLockToken = requestId/, 'Client keys cannot own another request lock.');

console.log('publish and preview verification gate tests passed');
