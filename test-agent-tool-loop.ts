import assert from 'node:assert/strict';
import {
  DEFAULT_AGENT_V3_BUDGET,
  ToolLoopController,
  buildAgentV3Context,
  isAgentV3Enabled,
  summarizeResearchForMemory,
  summarizeRunnerForMemory,
} from './src/services/agent-v3.ts';

assert.equal(isAgentV3Enabled({}), true);
assert.equal(isAgentV3Enabled({ AGENT_V3_ENABLED: '0' }), false);
assert.equal(isAgentV3Enabled({ AGENT_V3_ENABLED: 'false' }), false);

const controller = new ToolLoopController({ maxToolSteps: 2 });
assert.equal(controller.snapshot.remainingToolSteps, 2);
controller.claim('research');
controller.claim('runner');
assert.throws(() => controller.claim('fix'), /Tool loop budget exhausted/);

const context = buildAgentV3Context({
  baseContext: { project: { name: 'Demo' }, provider_cost_usd: 99 },
  runnerHistory: [{ status: 'failed', openrouter_raw: { hidden: true } }],
  researchHistory: [{ query: 'latest docs', token: 'sk-proj-hidden' }],
  toolBudget: DEFAULT_AGENT_V3_BUDGET,
});

const serialized = JSON.stringify(context);
assert.ok(serialized.includes('v3'));
assert.ok(!serialized.includes('provider_cost_usd'));
assert.ok(!serialized.includes('openrouter_raw'));
assert.ok(!serialized.includes('sk-proj-hidden'));

const runnerMemory = summarizeRunnerForMemory({
  run_id: 'run_1',
  status: 'failed',
  duration_ms: 12,
  checks: [
    { check_type: 'json_parse', status: 'failed', severity: 'medium', message: 'Invalid JSON', file_path: 'package.json' },
  ],
});
assert.equal(runnerMemory?.status, 'failed');
assert.equal(runnerMemory?.failed_checks[0].file_path, 'package.json');

const researchMemory = summarizeResearchForMemory({
  status: 'completed',
  provider: 'tavily',
  query: 'Supabase docs',
  message: 'ok',
  results: [{ title: 'Docs', url: 'https://example.com', snippet: 'Official docs' }],
});
assert.equal(researchMemory?.sources[0].url, 'https://example.com');

console.log('test-agent-tool-loop passed');
