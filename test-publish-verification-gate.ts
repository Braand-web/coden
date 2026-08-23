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
assert.match(builder, /JSON\.stringify\(\{ branch: 'main', confirmed: true \}\)/, 'Builder must send explicit publish confirmation.');

console.log('publish and preview verification gate tests passed');
