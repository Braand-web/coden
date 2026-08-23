import assert from 'node:assert/strict';
import { buildAgentV3Context } from './src/services/agent-v3.ts';

const context = buildAgentV3Context({
  baseContext: {
    project: { name: 'Demo' },
    api_key: 'sk-proj-hidden',
    public_payload: { ok: true },
  },
  runnerHistory: [
    { message: 'failed', platform_cost_usd: 5, output: 'ghp_secretvalue' },
  ],
  researchHistory: [
    { query: 'docs', url: 'https://example.com', supplier_invoice_id: 'inv_hidden' },
  ],
});

const json = JSON.stringify(context);
assert.ok(json.includes('Demo'));
assert.ok(json.includes('https://example.com'));
assert.ok(!json.includes('sk-proj-hidden'));
assert.ok(!json.includes('platform_cost_usd'));
assert.ok(!json.includes('supplier_invoice_id'));
assert.ok(!json.includes('ghp_secretvalue'));

console.log('test-agent-v3-redaction passed');
