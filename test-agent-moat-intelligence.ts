import assert from 'node:assert/strict';
import { buildAgentMoatIntelligence } from './src/services/agent-moat-intelligence.ts';

const report = buildAgentMoatIntelligence({
  runs: [
    {
      id: 'run_1',
      intent: 'build',
      model_id: 'openai/gpt-5.6-luna',
      status: 'completed',
      duration_ms: 42000,
    },
    {
      id: 'run_2',
      intent: 'debug_fix',
      model_id: 'openai/gpt-5.6-luna',
      status: 'failed',
      diagnostic_code: 'OPENROUTER_TIMEOUT',
      suggested_action: 'retry_later',
      duration_ms: 88000,
    },
    {
      id: 'run_3',
      intent: 'publish',
      model_id: 'anthropic/claude-opus-5',
      status: 'failed',
      diagnostic_code: 'DEPLOYMENT_PERSISTENCE_FAILED_AFTER_VERCEL_SUCCESS',
      duration_ms: 19000,
    },
  ],
  runnerFailures: [
    {
      status: 'failed',
      check_type: 'preview_render',
      severity: 'critical',
      message: 'Preview stayed blank after build.',
      duration_ms: 1200,
    },
    {
      status: 'failed',
      check_type: 'dependency_import',
      severity: 'high',
      message: 'Missing import from sk-live-secret-value should be redacted.',
      duration_ms: 900,
    },
  ],
  researchRows: [
    {
      provider: 'tavily',
      status: 'failed',
      diagnostic_code: 'WEB_RESEARCH_NOT_CONFIGURED',
      message: 'No research key configured.',
    },
  ],
  feedbackEvents: [
    {
      event_type: 'user_feedback',
      message: 'Incorrect or incomplete',
      payload: {
        rating: 'negative',
        feedback: 'reject',
        reasons: ['Incorrect or incomplete'],
        comment: 'The app did not follow my instructions.',
      },
    },
  ],
});

assert.equal(report.version, 'agent-moat-v1');
assert.ok(report.health_score < 90, 'health score should drop when failures are present');
assert.equal(report.data_moat_signals.runs_analyzed, 3);
assert.equal(report.data_moat_signals.runner_failures, 2);
assert.equal(report.data_moat_signals.feedback_events, 1);

const runnerReputation = report.module_reputation.find(item => item.module === 'runner');
assert.ok(runnerReputation, 'runner reputation should exist');
assert.notEqual(runnerReputation?.status, 'strong', 'runner should be watch/weak with critical failures');

const publishReputation = report.module_reputation.find(item => item.module === 'publish');
assert.ok(publishReputation?.signals.some(signal => signal.includes('DEPLOYMENT_PERSISTENCE')));

const economyModel = report.model_performance.find(item => item.model_id === 'openai/gpt-5.6-luna');
assert.equal(economyModel?.attempts, 2);
assert.equal(economyModel?.failures, 1);
assert.equal(economyModel?.recommendation, 'avoid_for_now');

assert.ok(report.recurring_risks.some(risk => risk.key.includes('OPENROUTER_TIMEOUT')));
assert.ok(report.improvement_backlog.some(item => item.title.includes('runner failures')));

const serialized = JSON.stringify(report);
assert.ok(!serialized.includes('sk-live-secret-value'), 'raw secrets must not leak into moat report');
assert.ok(serialized.includes('[redacted]'), 'secret-like content should be redacted');

console.log('test-agent-moat-intelligence passed');
