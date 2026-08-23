import { redactSecrets } from './secret-redaction.ts';

type AgentRunSignal = {
  id?: string | null;
  intent?: string | null;
  mode?: string | null;
  model_id?: string | null;
  status?: string | null;
  diagnostic_code?: string | null;
  suggested_action?: string | null;
  duration_ms?: number | null;
  created_at?: string | null;
};

type RunnerSignal = {
  status?: string | null;
  check_type?: string | null;
  severity?: string | null;
  message?: string | null;
  duration_ms?: number | null;
};

type ResearchSignal = {
  status?: string | null;
  provider?: string | null;
  diagnostic_code?: string | null;
  message?: string | null;
};

type FeedbackSignal = {
  event_type?: string | null;
  status?: string | null;
  message?: string | null;
  payload?: any;
  public_payload?: any;
};

type ModuleName =
  | 'intent_router'
  | 'conversation'
  | 'builder'
  | 'design'
  | 'runner'
  | 'auto_fix'
  | 'publish'
  | 'research'
  | 'media'
  | 'auth'
  | 'database'
  | 'billing';

type ModuleReputation = {
  module: ModuleName;
  score: number;
  status: 'strong' | 'watch' | 'weak';
  signals: string[];
  suggested_action: string;
};

type ModelPerformance = {
  model_id: string;
  attempts: number;
  failures: number;
  success_rate: number;
  average_duration_ms: number;
  recommendation: 'prefer' | 'monitor' | 'avoid_for_now';
};

type RecurringRisk = {
  key: string;
  count: number;
  severity: 'high' | 'medium' | 'low';
  suggested_action: string;
};

type ImprovementBacklogItem = {
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  action: string;
};

export type AgentMoatReport = {
  version: 'agent-moat-v1';
  health_score: number;
  module_reputation: ModuleReputation[];
  model_performance: ModelPerformance[];
  recurring_risks: RecurringRisk[];
  improvement_backlog: ImprovementBacklogItem[];
  data_moat_signals: {
    runs_analyzed: number;
    feedback_events: number;
    runner_failures: number;
    research_events: number;
  };
};

type AgentMoatInput = {
  runs?: AgentRunSignal[];
  runnerFailures?: RunnerSignal[];
  researchRows?: ResearchSignal[];
  feedbackEvents?: FeedbackSignal[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizedText(value: unknown, limit = 180) {
  const text = redactSecrets(String(value || '').replace(/\s+/g, ' ').trim(), '[redacted]');
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function addSignal(map: Map<ModuleName, string[]>, module: ModuleName, signal: string) {
  const current = map.get(module) || [];
  if (!current.includes(signal)) current.push(signal);
  map.set(module, current.slice(0, 6));
}

function moduleForRun(run: AgentRunSignal): ModuleName {
  const haystack = [
    run.intent,
    run.mode,
    run.diagnostic_code,
    run.suggested_action,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/auth|session|oauth|login|sign/.test(haystack)) return 'auth';
  if (/publish|deploy|domain|vercel|live/.test(haystack)) return 'publish';
  if (/database|supabase|sql|storage|rls/.test(haystack)) return 'database';
  if (/billing|credit|wallet|stripe|plan|quota/.test(haystack)) return 'billing';
  if (/design|ui|ux|visual|theme|prompt/.test(haystack)) return 'design';
  if (/media|image|video|ugc|fal|kling|sora|veo|flux/.test(haystack)) return 'media';
  if (/research|web|docs|source/.test(haystack)) return 'research';
  if (/conversation|answer|explain|reformulation|strategy|clarification/.test(haystack)) return 'conversation';
  if (/intent|router|classification/.test(haystack)) return 'intent_router';
  if (/fix|debug|verify|runner|test|lint|build/.test(haystack)) return 'runner';
  return 'builder';
}

function riskSuggestion(key: string) {
  const lower = key.toLowerCase();
  if (/auth|session|oauth/.test(lower)) return 'Prioritize auth/session hardening and replay this case in smoke tests.';
  if (/openrouter|provider|model|quota|timeout/.test(lower)) return 'Tune provider routing, fallback and public error mapping for this model/provider.';
  if (/runner|build|lint|import|preview|blank/.test(lower)) return 'Expand runner checks and auto-fix playbooks for this failure class.';
  if (/publish|deploy|vercel|domain/.test(lower)) return 'Audit publish persistence, live URL proxying and deployment status transitions.';
  if (/feedback|instruction|incomplete|wrong/.test(lower)) return 'Review the prompt policy and add regression examples from this feedback.';
  return 'Review recent runs and add a targeted regression test.';
}

function reputationStatus(score: number): ModuleReputation['status'] {
  if (score >= 82) return 'strong';
  if (score >= 64) return 'watch';
  return 'weak';
}

function moduleAction(module: ModuleName, status: ModuleReputation['status']) {
  if (status === 'strong') return 'Keep collecting signals and preserve this behavior.';
  const actions: Record<ModuleName, string> = {
    intent_router: 'Add intent regression examples and prefer clarification before mutation when confidence is low.',
    conversation: 'Shorten simple-answer path and keep it away from preview/runner unless the user asks to build.',
    builder: 'Run generated-app quality gates and require React/Vite structure for real apps.',
    design: 'Feed weak outputs into design audit and enforce platform-specific UI patterns.',
    runner: 'Promote repeated runner failures into auto-fix playbooks and regression tests.',
    auto_fix: 'Limit broad rewrites and patch only files linked to the failing check.',
    publish: 'Check deployment persistence, status enums, proxy compatibility and live/preview separation.',
    research: 'Configure a research provider or gracefully skip with a useful fallback.',
    media: 'Keep media generations isolated from app builds and estimate credits before provider calls.',
    auth: 'Verify session refresh, OAuth callback URLs and backend-only service role usage.',
    database: 'Audit generated Supabase clients, RLS assumptions and schema persistence.',
    billing: 'Keep user endpoints credit-only and verify plan/rate mapping after pricing changes.',
  };
  return actions[module];
}

function summarizeModelPerformance(runs: AgentRunSignal[]): ModelPerformance[] {
  const groups = new Map<string, AgentRunSignal[]>();
  for (const run of runs) {
    const modelId = String(run.model_id || 'auto').trim() || 'auto';
    const list = groups.get(modelId) || [];
    list.push(run);
    groups.set(modelId, list);
  }

  return Array.from(groups.entries())
    .map(([model_id, modelRuns]) => {
      const attempts = modelRuns.length;
      const failures = modelRuns.filter(run => ['failed', 'cancelled'].includes(String(run.status || '').toLowerCase())).length;
      const durations = modelRuns
        .map(run => Number(run.duration_ms || 0))
        .filter(value => Number.isFinite(value) && value > 0);
      const successRate = attempts ? (attempts - failures) / attempts : 0;
      return {
        model_id: normalizedText(model_id, 120),
        attempts,
        failures,
        success_rate: Number(successRate.toFixed(2)),
        average_duration_ms: durations.length
          ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
          : 0,
        recommendation: successRate >= 0.88 && attempts >= 3
          ? 'prefer'
          : successRate < 0.65 && attempts >= 2
            ? 'avoid_for_now'
            : 'monitor',
      } satisfies ModelPerformance;
    })
    .sort((a, b) => (b.attempts - a.attempts) || (a.success_rate - b.success_rate));
}

export function buildAgentMoatIntelligence(input: AgentMoatInput): AgentMoatReport {
  const runs = input.runs || [];
  const runnerFailures = input.runnerFailures || [];
  const researchRows = input.researchRows || [];
  const feedbackEvents = input.feedbackEvents || [];

  const failedRuns = runs.filter(run => String(run.status || '').toLowerCase() === 'failed');
  const cancelledRuns = runs.filter(run => String(run.status || '').toLowerCase() === 'cancelled');
  const negativeFeedback = feedbackEvents.filter(event => {
    const payload = event.payload || event.public_payload || {};
    const text = `${event.message || ''} ${payload.feedback || ''} ${payload.rating || ''} ${(payload.reasons || []).join(' ')}`.toLowerCase();
    return /negative|reject|incorrect|incomplete|bug|slow|not follow|hors sujet|lost/.test(text);
  });
  const failedResearch = researchRows.filter(row => {
    const status = String(row.status || '').toLowerCase();
    return status && !['success', 'ok', 'skipped'].includes(status);
  });

  const failureRatio = runs.length ? failedRuns.length / runs.length : 0;
  const cancelRatio = runs.length ? cancelledRuns.length / runs.length : 0;
  const healthScore = clamp(
    100
    - failureRatio * 45
    - cancelRatio * 16
    - Math.min(24, runnerFailures.length * 4)
    - Math.min(14, negativeFeedback.length * 5)
    - Math.min(8, failedResearch.length * 2),
  );

  const moduleSignals = new Map<ModuleName, string[]>();
  const modulePenalty = new Map<ModuleName, number>();
  const penalize = (module: ModuleName, amount: number, signal: string) => {
    modulePenalty.set(module, (modulePenalty.get(module) || 0) + amount);
    addSignal(moduleSignals, module, signal);
  };

  for (const run of failedRuns) {
    const module = moduleForRun(run);
    penalize(module, 14, `Failed run${run.diagnostic_code ? `: ${normalizedText(run.diagnostic_code, 80)}` : ''}`);
  }
  for (const run of cancelledRuns) {
    penalize(moduleForRun(run), 4, 'Cancelled run signal');
  }
  for (const row of runnerFailures) {
    const message = normalizedText(row.message || row.check_type || 'runner failure', 120);
    penalize('runner', String(row.severity || '').toLowerCase() === 'critical' ? 16 : 10, message);
    if (/import|module|dependency/i.test(message)) penalize('auto_fix', 8, 'Repeated import/dependency failure');
    if (/blank|preview|render/i.test(message)) penalize('builder', 8, 'Preview or render failure detected');
    if (/contrast|responsive|layout|button|form/i.test(message)) penalize('design', 6, 'Design/functionality quality warning');
  }
  for (const row of failedResearch) {
    penalize('research', 8, normalizedText(row.diagnostic_code || row.message || row.provider || 'research failed', 120));
  }
  for (const event of negativeFeedback) {
    const payload = event.payload || event.public_payload || {};
    const reasons = Array.isArray(payload.reasons) ? payload.reasons.join(', ') : '';
    const text = normalizedText(reasons || event.message || payload.comment || 'negative feedback', 120);
    penalize('intent_router', 6, `Feedback: ${text}`);
    penalize('conversation', 4, 'User feedback requires response-quality review');
  }

  const modules: ModuleName[] = [
    'intent_router',
    'conversation',
    'builder',
    'design',
    'runner',
    'auto_fix',
    'publish',
    'research',
    'media',
    'auth',
    'database',
    'billing',
  ];

  const moduleReputation = modules.map(module => {
    const score = clamp(92 - (modulePenalty.get(module) || 0));
    const status = reputationStatus(score);
    return {
      module,
      score,
      status,
      signals: moduleSignals.get(module) || ['No negative signal in the sampled window.'],
      suggested_action: moduleAction(module, status),
    };
  });

  const riskCounts = new Map<string, number>();
  const addRisk = (key: string) => {
    const safeKey = normalizedText(key || 'unknown', 120);
    riskCounts.set(safeKey, (riskCounts.get(safeKey) || 0) + 1);
  };
  failedRuns.forEach(run => addRisk(run.diagnostic_code || run.suggested_action || 'failed_run'));
  runnerFailures.forEach(row => addRisk(row.check_type || row.message || 'runner_failure'));
  failedResearch.forEach(row => addRisk(row.diagnostic_code || row.provider || 'research_failure'));
  negativeFeedback.forEach(event => {
    const payload = event.payload || event.public_payload || {};
    addRisk(payload.feedback || payload.rating || 'negative_user_feedback');
  });

  const recurringRisks = Array.from(riskCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, count]) => ({
      key,
      count,
      severity: count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low',
      suggested_action: riskSuggestion(key),
    } satisfies RecurringRisk));

  const improvementBacklog: ImprovementBacklogItem[] = [];
  if (healthScore < 82) {
    improvementBacklog.push({
      priority: 'high',
      title: 'Stabilize the core agent loop',
      reason: `Health score is ${healthScore}/100 in the sampled window.`,
      action: 'Replay failing prompts, tighten intent routing, then verify build/edit/publish paths end to end.',
    });
  }
  if (runnerFailures.length) {
    improvementBacklog.push({
      priority: 'high',
      title: 'Promote runner failures into auto-fix playbooks',
      reason: `${runnerFailures.length} runner failure signal(s) were found.`,
      action: 'Group failures by check type and add targeted patches before preview_ready.',
    });
  }
  if (negativeFeedback.length) {
    improvementBacklog.push({
      priority: 'medium',
      title: 'Close the feedback loop',
      reason: `${negativeFeedback.length} negative user feedback signal(s) were found.`,
      action: 'Convert repeated reasons into intent examples, response-style rules and regression tests.',
    });
  }
  if (failedResearch.length) {
    improvementBacklog.push({
      priority: 'medium',
      title: 'Harden web research fallback',
      reason: `${failedResearch.length} research failure signal(s) were found.`,
      action: 'Verify provider keys, citation parsing and no-key fallback copy.',
    });
  }
  for (const model of summarizeModelPerformance(runs).filter(item => item.recommendation === 'avoid_for_now').slice(0, 3)) {
    improvementBacklog.push({
      priority: 'medium',
      title: `Route away from ${model.model_id}`,
      reason: `Observed success rate is ${Math.round(model.success_rate * 100)}% over ${model.attempts} attempt(s).`,
      action: 'Lower this model priority for similar tasks until fresh successful runs recover confidence.',
    });
  }
  if (!improvementBacklog.length) {
    improvementBacklog.push({
      priority: 'low',
      title: 'Keep collecting quality signals',
      reason: 'No major reliability pattern was detected in the sampled window.',
      action: 'Continue logging runs, feedback, research and runner results for trend detection.',
    });
  }

  return {
    version: 'agent-moat-v1',
    health_score: healthScore,
    module_reputation: moduleReputation,
    model_performance: summarizeModelPerformance(runs),
    recurring_risks: recurringRisks,
    improvement_backlog: improvementBacklog.slice(0, 10),
    data_moat_signals: {
      runs_analyzed: runs.length,
      feedback_events: feedbackEvents.length,
      runner_failures: runnerFailures.length,
      research_events: researchRows.length,
    },
  };
}
