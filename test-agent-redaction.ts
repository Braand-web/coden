import assert from 'node:assert/strict';
import { redactAgentPayload } from './src/services/agent-v2.ts';

const payload = {
  ok: 'visible',
  real_cost_usd: 12,
  provider_cost_usd: 2,
  platform_cost_usd: 1,
  margin_percent: 80,
  stripe_fee: 0.3,
  openrouter_raw: { id: 'hidden' },
  supplier_invoice_id: 'inv_hidden',
  nested: {
    token: 'sk-proj-secret',
    normal: 'hello ghp_abc123',
  },
};

const redacted = redactAgentPayload(payload);
const json = JSON.stringify(redacted);

assert.equal(redacted.ok, 'visible');
assert.equal('real_cost_usd' in redacted, false);
assert.equal('openrouter_raw' in redacted, false);
assert.equal('token' in redacted.nested, false);
assert.equal(redacted.nested.normal, 'hello [redacted]');
assert.ok(!json.includes('inv_hidden'));
assert.ok(!json.includes('provider_cost_usd'));
assert.ok(!json.includes('sk-proj-secret'));
assert.ok(!json.includes('ghp_abc123'));

console.log('test-agent-redaction passed');
