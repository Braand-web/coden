import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const builder = fs.readFileSync('builder.html', 'utf8');
const buildRunner = fs.readFileSync('src/services/build-runner.ts', 'utf8');
const sandbox = fs.readFileSync('src/services/sandbox/project-sandbox.ts', 'utf8');
const analytics = fs.readFileSync('src/services/analytics-snippet.ts', 'utf8');

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`Security boundary regression: ${message}`);
}

assert(/sandbox="allow-scripts allow-forms"/.test(builder), 'Builder preview iframe is not sandboxed.');
assert(/Content-Security-Policy.*sandbox allow-scripts allow-forms/s.test(server), 'Published HTML is missing an opaque sandbox CSP.');
assert(/isPublishedDeploymentReady\(deployment\)/.test(server), 'Public routes do not require a ready deployment.');
assert(/isAllowedPublishedUpstreamUrl\(project, candidate\)/.test(server), 'Published proxy targets are not allowlisted.');
assert(/Invalid analytics token/.test(server) && /analyticsTokenForProject/.test(server), 'Analytics collection is not project-bound.');
assert(/res\.json\(\{\s*success: true,\s*status: 'ok',\s*service: 'coden-saas'/.test(server), 'Public health response is not minimized.');
assert(/CODEN_BUILD_RUNNER_ISOLATION !== 'container'/.test(buildRunner), 'Production build runner is not fail-closed.');
{
  // And in behaviour, not only in text: production refuses a local generated
  // build unless an isolated worker is declared.
  const { localBuildAllowed } = await import('./src/services/build-runner.ts');
  assert(localBuildAllowed({ NODE_ENV: 'production' }) === false, 'Production allows a local generated build.');
  assert(localBuildAllowed({ NODE_ENV: 'production', CODEN_BUILD_RUNNER_ISOLATION: 'container' }) === true, 'An isolated build worker is not honoured.');
}
assert(/SECURE_SANDBOX_REQUIRED/.test(sandbox), 'Production host-process sandbox is not fail-closed.');
assert(/analytics_token/.test(analytics), 'Generated analytics beacon does not carry its project-bound token.');

console.log('security boundary tests passed');
