/**
 * Measures the guard on the corpus: false negatives, false positives, latency.
 * The same function runs offline (deterministic layers, in a test) and live
 * (with the model stage, from the admin evaluation).
 */
import { ADVERSARIAL_SET, type AdversarialCase, type CorpusMetrics } from './adversarial-set.ts';
import { createActionGuard } from './action-guard.ts';
import type { ClassifierAsk } from './classifier.ts';
import type { GuardDecisionKind, GuardMode } from './action-types.ts';

export type CaseOutcome = { id: string; group: AdversarialCase['group']; expected: GuardDecisionKind; got: GuardDecisionKind; stage: string; latencyMs: number; note: string; needsModel: boolean };

export async function evaluateCorpus(options: { ask?: ClassifierAsk; modelMode?: GuardMode; skipModelCases?: boolean; cases?: AdversarialCase[] } = {}): Promise<{ metrics: CorpusMetrics; outcomes: CaseOutcome[]; latency: { fastP95Ms: number; modelP50Ms: number | null; modelP95Ms: number | null } }> {
  const outcomes: CaseOutcome[] = [];
  for (const testCase of options.cases ?? ADVERSARIAL_SET) {
    if (testCase.needsModel && options.skipModelCases) continue;
    const guard = createActionGuard({
      mode: 'enforce',
      modelMode: options.modelMode ?? (options.ask ? 'enforce' : 'off'),
      ask: options.ask,
      context: { userMessages: testCase.userMessages, rules: testCase.rules ?? [], projectId: 'project-under-test', userId: 'user-under-test' },
    });
    if (testCase.priorDeletes) guard.noteDeletes(testCase.priorDeletes);
    let got: GuardDecisionKind; let stage = 'hard_rule'; let latencyMs = 0;
    if (testCase.action.tool === 'delegate_to_subagents') {
      const verdict = guard.checkDelegation((testCase.action.args.tasks as any[]) || []);
      got = verdict.ok ? 'allow' : 'block';
    } else {
      const started = performance.now();
      const decision = await guard.check(testCase.action);
      latencyMs = performance.now() - started;
      got = decision.decision; stage = decision.stage;
    }
    outcomes.push({ id: testCase.id, group: testCase.group, expected: testCase.expect, got, stage, latencyMs, note: testCase.note, needsModel: Boolean(testCase.needsModel) });
  }
  const falseNegatives = outcomes.filter(outcome => outcome.expected !== 'allow' && outcome.got === 'allow').map(outcome => outcome.id);
  const falsePositives = outcomes.filter(outcome => outcome.expected === 'allow' && outcome.got !== 'allow').map(outcome => outcome.id);
  const wrongKind = outcomes.filter(outcome => outcome.expected !== 'allow' && outcome.got !== 'allow' && outcome.got !== outcome.expected).map(outcome => outcome.id);
  const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : null;
  const fast = outcomes.filter(outcome => outcome.stage !== 'model').map(outcome => outcome.latencyMs);
  const model = outcomes.filter(outcome => outcome.stage === 'model').map(outcome => outcome.latencyMs);
  return {
    metrics: { cases: outcomes.length, falseNegatives, falsePositives, wrongKind, correct: outcomes.filter(outcome => outcome.expected === outcome.got).length, skippedNeedsModel: (options.cases ?? ADVERSARIAL_SET).filter(testCase => testCase.needsModel && options.skipModelCases).length },
    outcomes,
    latency: { fastP95Ms: Math.round((percentile(fast, 0.95) ?? 0) * 1000) / 1000, modelP50Ms: model.length ? Math.round(percentile(model, 0.5)!) : null, modelP95Ms: model.length ? Math.round(percentile(model, 0.95)!) : null },
  };
}
