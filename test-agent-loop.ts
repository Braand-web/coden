import assert from 'node:assert/strict';
import {
  buildAgentContextPack,
  isAgentV2Enabled,
  summarizeVerificationChecks,
  verifyGeneratedProject,
} from './src/services/agent-v2.ts';

assert.equal(isAgentV2Enabled({}), true);
assert.equal(isAgentV2Enabled({ AGENT_V2_ENABLED: 'false' }), false);
assert.equal(isAgentV2Enabled({ AGENT_V2_ENABLED: '0' }), false);

const checks = verifyGeneratedProject({
  projectName: 'Test',
  files: [
    { path: 'index.html', language: 'html', content: '<!doctype html><html><head><title>Test</title><meta name="description" content="Demo"></head><body><h1>Test</h1></body></html>' },
  ],
  previewHtml: '<!doctype html><html><head><title>Test</title><meta name="description" content="Demo"></head><body><h1>Test</h1></body></html>',
});

assert.equal(summarizeVerificationChecks(checks).status, 'passed');

const failing = verifyGeneratedProject({
  projectName: 'Unsafe',
  files: [
    { path: '../.env', content: 'OPENROUTER_API_KEY=sk-test-secret', language: 'text' },
    { path: 'templates/restaurant-app/index.html', content: '<html></html>', language: 'html' },
  ],
  previewHtml: '',
});

assert.ok(failing.some(check => check.key === 'safe_paths' && check.status === 'fail'));
assert.ok(failing.some(check => check.key === 'no_env_files' && check.status === 'fail'));
assert.ok(failing.some(check => check.key === 'no_forbidden_pages' && check.status === 'fail'));
assert.equal(summarizeVerificationChecks(failing).status, 'failed');

const context = buildAgentContextPack({
  requestId: 'req_1',
  project: { id: 'p1', name: 'Demo', preview_status: 'ready', secret: 'sk-test-123' },
  files: [{ path: 'index.html', content: '<h1>Demo</h1>' }],
  messages: [{ role: 'user', content: 'hello', openrouter_raw: { secret: 'x' } }],
  events: [{ event_type: 'token', message: 'ok', provider_cost_usd: 9 }],
  versions: [{ id: 'v1', version_number: 1, diff_summary: { real_cost_usd: 1 } }],
  memory: [{ summary: 'prefers clean UI', supplier_invoice_id: 'secret' }],
});

const serialized = JSON.stringify(context);
assert.ok(!serialized.includes('sk-test-123'));
assert.ok(!serialized.includes('provider_cost_usd'));
assert.ok(!serialized.includes('supplier_invoice_id'));
assert.ok(serialized.includes('Demo'));

console.log('test-agent-loop passed');
