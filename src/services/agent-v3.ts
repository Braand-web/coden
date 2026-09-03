import type { ResearchResult } from './web-research-gateway.ts';
import type { RunnerResult } from './project-runner.ts';
import { redactSecrets } from './secret-redaction.ts';

export type ToolLoopBudget = {
  maxToolSteps: number;
  maxAutoFixAttempts: number;
  runnerTimeoutMs: number;
};

export const DEFAULT_AGENT_V3_BUDGET: ToolLoopBudget = {
  maxToolSteps: 10,
  maxAutoFixAttempts: 3,
  runnerTimeoutMs: 120_000,
};

export function isAgentV3Enabled(env: Record<string, any> = {}) {
  const raw = String(env.AGENT_V3_ENABLED ?? env.AGENT_V2_ENABLED ?? '').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

export function buildAgentV3Context(input: {
  baseContext: Record<string, any>;
  runnerHistory?: any[];
  researchHistory?: any[];
  toolBudget?: ToolLoopBudget;
}) {
  return {
    ...redactPublic(input.baseContext),
    agent_version: 'v3',
    tool_budget: input.toolBudget || DEFAULT_AGENT_V3_BUDGET,
    runner_history: (input.runnerHistory || []).slice(0, 8).map(redactPublic),
    research_history: (input.researchHistory || []).slice(0, 6).map(redactPublic),
  };
}

export function summarizeRunnerForMemory(result?: RunnerResult | null) {
  if (!result) return null;
  const failed = result.checks.filter(check => check.status === 'failed').slice(0, 6);
  return {
    status: result.status,
    duration_ms: result.duration_ms,
    failed_checks: failed.map(check => ({
      check_type: check.check_type,
      message: check.message,
      file_path: check.file_path || null,
      severity: check.severity,
    })),
  };
}

export function summarizeResearchForMemory(result?: ResearchResult | null) {
  if (!result) return null;
  return {
    status: result.status,
    provider: result.provider,
    query: result.query,
    diagnostic_code: result.diagnostic_code || null,
    sources: result.results.slice(0, 4).map(item => ({ title: item.title, url: item.url })),
  };
}

function redactPublic(value: any): any {
  if (Array.isArray(value)) return value.map(redactPublic);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? redactString(value) : value;
  const output: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/cost|margin|token|secret|password|api[_-]?key|openrouter_raw|provider_cost|supplier_invoice/i.test(key)) continue;
    output[key] = redactPublic(item);
  }
  return output;
}

function redactString(value: string) {
  return redactSecrets(value, '[redacted]');
}
