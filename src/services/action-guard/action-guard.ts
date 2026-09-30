/**
 * The action guard: one question before a risky action — did the user
 * authorise this precise action on this precise resource?
 *
 * Tier 1 passes; tier 2 gets a light check; tier 3 goes through a fast filter
 * and, only when that doubts, to a separate model that sees the person's words
 * and the action, and nothing else. The answer is allow, block (the agent is
 * told why and looks for a safer way) or ask (the person gets a plain
 * question and a button). Repeated blocks pause the task instead of letting
 * the agent thrash.
 *
 * It is one layer: the sandbox, least privilege, cost ceilings and rollback
 * all stand behind it, and the protected core below it cannot be argued with.
 */
import { createHash } from 'node:crypto';
import { classifyWithModel, type ClassifierAsk } from './classifier.ts';
import { fastFilter, plainQuestion } from './fast-filter.ts';
import { categoryOf, tierOf } from './action-tiers.ts';
import { screenDelegation, screenReturn, screenSharedContent, screenToolResult, type ContentVerdict } from './screen.ts';
import { MASS_DELETE_THRESHOLD } from './light-check.ts';
import { describeAction } from './classifier.ts';
import type { ActionCategory, GuardContext, GuardDecision, GuardMode, ToolAction } from './action-types.ts';

export type GuardJournalEntry = {
  at: string;
  runId?: string;
  projectId: string;
  userId?: string;
  tool: string;
  category: ActionCategory;
  tier: 1 | 2 | 3;
  decision: GuardDecision['decision'];
  stage: GuardDecision['stage'];
  rule?: string;
  reason: string;
  latencyMs: number;
  cached: boolean;
  mode: GuardMode;
  shadowDecision?: string;
  actor: 'agent' | 'subagent';
  /** The action, redacted and shortened — never a file body or a tool result. */
  summary: string;
};

export type ActionGuardOptions = {
  mode: GuardMode;
  /** The model stage: `enforce` applies its verdict, `shadow` logs it beside the fallback, `off` skips it. */
  modelMode: GuardMode;
  context: Omit<GuardContext, 'actor'>;
  ask?: ClassifierAsk;
  journal?: (entry: GuardJournalEntry) => void;
  runId?: string;
  now?: () => number;
  modelTimeoutMs?: number;
  /** Blocks in a row, and blocks in all, before the task pauses. */
  pauseAfterConsecutive?: number;
  pauseAfterTotal?: number;
};

const CACHE_TTL_MS = 5 * 60_000;

export type ActionGuard = ReturnType<typeof createActionGuard>;

export function createActionGuard(options: ActionGuardOptions) {
  const now = options.now ?? Date.now;
  const consecutiveLimit = options.pauseAfterConsecutive ?? 3;
  const totalLimit = options.pauseAfterTotal ?? 10;
  const cache = new Map<string, { at: number; decision: GuardDecision }>();
  let consecutiveBlocks = 0;
  let totalBlocks = 0;
  let deletes = 0;
  const stats = { checked: 0, allowed: 0, blocked: 0, asked: 0, paused: 0, modelCalls: 0, cacheHits: 0, modelMs: 0, fastMs: 0 };
  const context = (actor: 'agent' | 'subagent'): GuardContext => ({ ...options.context, actor });

  const record = (action: ToolAction, decision: GuardDecision, actor: 'agent' | 'subagent') => {
    try {
      options.journal?.({
        at: new Date(now()).toISOString(), runId: options.runId, projectId: options.context.projectId, userId: options.context.userId,
        tool: action.tool, category: decision.category, tier: decision.tier, decision: decision.decision, stage: decision.stage, rule: decision.rule,
        reason: decision.reason, latencyMs: decision.latencyMs, cached: Boolean(decision.cached), mode: options.mode, shadowDecision: decision.shadow?.decision, actor,
        summary: describeAction(action).slice(0, 300),
      });
    } catch { /* the journal never fails an action */ }
  };

  const cacheKey = (action: ToolAction, category: ActionCategory) => {
    const digest = createHash('sha1').update(JSON.stringify([action.tool, category, action.args, options.context.userMessages.slice(-6), options.context.rules])).digest('hex');
    return digest;
  };

  async function decide(action: ToolAction, actor: 'agent' | 'subagent'): Promise<GuardDecision> {
    const started = now();
    const ctx = context(actor);
    // A run that keeps deleting is no longer tidying: past the threshold every further deletion is judged as a mass deletion.
    const treatAsMassDelete = action.tool === 'delete_file' && deletes >= MASS_DELETE_THRESHOLD;
    const effective: ToolAction = treatAsMassDelete ? { tool: 'mass_delete', args: action.args } : action;
    const category = treatAsMassDelete ? 'mass_delete' as const : categoryOf(action);
    const tier = treatAsMassDelete ? 3 as const : tierOf(action);

    const key = tier === 3 ? cacheKey(effective, category) : '';
    if (key) {
      const hit = cache.get(key);
      if (hit && now() - hit.at < CACHE_TTL_MS) { stats.cacheHits += 1; return { ...hit.decision, stage: 'cache', cached: true, latencyMs: now() - started }; }
    }

    let verdict = treatAsMassDelete
      ? fastFilterForMass(action, ctx)
      : fastFilter(action, ctx);
    let decision: GuardDecision;
    if (verdict.kind === 'decided') {
      decision = { decision: verdict.decision, category: verdict.category, tier: verdict.tier, stage: verdict.stage, reason: verdict.reason, question: verdict.question, rule: verdict.rule, latencyMs: now() - started };
      stats.fastMs += decision.latencyMs;
    } else {
      const fallback = verdict.fallback;
      const base: GuardDecision = { decision: fallback.decision, category: verdict.category, tier: verdict.tier, stage: 'fallback', reason: fallback.reason, question: fallback.question, latencyMs: 0 };
      if (options.ask && options.modelMode !== 'off') {
        stats.modelCalls += 1;
        const run = () => classifyWithModel({ ask: options.ask!, action, context: ctx, why: verdict.kind === 'doubt' ? verdict.why : '', timeoutMs: options.modelTimeoutMs ?? 4000 });
        if (options.modelMode === 'enforce') {
          const modelStarted = now();
          const answer = await run();
          stats.modelMs += now() - modelStarted;
          if (answer) {
            // A model can lower a fallback's caution only for what is local; it can always raise it.
            decision = { ...base, decision: answer.decision, stage: 'model', reason: answer.reason, question: answer.decision === 'ask' ? (answer.question || fallback.question || plainQuestion(verdict.category, action)) : undefined, latencyMs: now() - started };
          } else {
            decision = { ...base, latencyMs: now() - started };
          }
        } else {
          // Shadow: the action goes on with the fallback; what the model would have said is logged when it arrives.
          decision = { ...base, latencyMs: now() - started };
          void run().then(answer => {
            if (answer) record(action, { ...decision, shadow: { decision: answer.decision, reason: answer.reason }, stage: 'model', reason: `[shadow] ${answer.reason}` }, actor);
          });
        }
      } else {
        decision = { ...base, latencyMs: now() - started };
      }
      if (decision.decision === 'ask' && !decision.question) decision.question = plainQuestion(verdict.category, action);
    }
    if (key && decision.decision !== 'pause') cache.set(key, { at: now(), decision });
    return decision;
  }

  /** Mass deletion is outward the moment it starts: it needs the person's word, or a question. */
  function fastFilterForMass(action: ToolAction, ctx: GuardContext) {
    const massAction: ToolAction = { tool: 'delete_file', args: action.args };
    const verdict = fastFilter(massAction, ctx);
    if (verdict.kind === 'decided' && verdict.decision === 'block') return verdict;
    // Explicit consent lives in the category's own pattern.
    return fastFilterConsent(ctx, action);
  }
  function fastFilterConsent(ctx: GuardContext, action: ToolAction) {
    const said = ctx.userMessages.join('\n');
    if (/\b(?:supprime[rz]?|efface[rz]?|nettoie[rz]?|delete|remove|clean(?: up)?|wipe)\b[^.\n]{0,40}\b(?:tous|toutes|tout|all|every|everything|les fichiers|the files|le dossier|the folder|le projet|the project|le code|the code)\b/i.test(said)) {
      return { kind: 'decided' as const, decision: 'allow' as const, category: 'mass_delete' as const, tier: 3 as const, stage: 'fast' as const, reason: 'Suppression demandée par l’utilisateur.' };
    }
    return { kind: 'decided' as const, decision: 'ask' as const, category: 'mass_delete' as const, tier: 3 as const, stage: 'fast' as const, reason: 'Beaucoup de fichiers supprimés sans demande explicite.', question: plainQuestion('mass_delete', action), rule: 'mass_delete' };
  }

  return {
    /**
     * Judge one action. Never throws: a guard that fails must not take the run
     * down with it — but it fails closed for outward actions, never open.
     */
    async check(action: ToolAction, actor: 'agent' | 'subagent' = 'agent'): Promise<GuardDecision> {
      if (options.mode === 'off') return { decision: 'allow', category: categoryOf(action), tier: tierOf(action), stage: 'mode', reason: 'Le contrôle est désactivé.', latencyMs: 0 };
      stats.checked += 1;
      let decision: GuardDecision;
      try {
        decision = await decide(action, actor);
      } catch (error) {
        const category = categoryOf(action);
        const outward = tierOf(action) === 3 && category !== 'shell' && category !== 'network' && category !== 'install';
        decision = { decision: outward ? 'ask' : 'allow', category, tier: tierOf(action), stage: 'fallback', reason: 'Le contrôle a rencontré une erreur.', question: outward ? plainQuestion(category, action) : undefined, latencyMs: 0 };
      }

      // Shadow mode: what would have happened is logged; nothing is stopped.
      if (options.mode === 'shadow' && decision.decision !== 'allow') {
        record(action, { ...decision, shadow: { decision: decision.decision, reason: decision.reason } }, actor);
        return { ...decision, decision: 'allow', stage: 'mode', reason: 'Contrôle en observation : action laissée passer.' };
      }

      if (decision.decision === 'allow') {
        consecutiveBlocks = 0;
        stats.allowed += 1;
        if (action.tool === 'delete_file') deletes += 1;
      } else if (decision.decision === 'block') {
        consecutiveBlocks += 1;
        totalBlocks += 1;
        stats.blocked += 1;
      } else if (decision.decision === 'ask') {
        stats.asked += 1;
      }

      // Thrashing against the guard is a sign the task needs a person, not more attempts.
      if (decision.decision === 'block' && (consecutiveBlocks >= consecutiveLimit || totalBlocks >= totalLimit)) {
        const asAnswer: GuardDecision = {
          ...decision, decision: 'pause', stage: decision.stage,
          reason: `${consecutiveBlocks >= consecutiveLimit ? `${consecutiveBlocks} blocages de suite` : `${totalBlocks} blocages au total`} : ${decision.reason}`,
          question: 'Je n’arrive pas à avancer sans faire quelque chose que je ne peux pas faire seul. Comment veux-tu continuer ?',
        };
        consecutiveBlocks = 0;
        totalBlocks = 0;
        stats.paused += 1;
        record(action, asAnswer, actor);
        return asAnswer;
      }
      record(action, decision, actor);
      return decision;
    },

    /** An instruction to a sub-agent, before it is delivered. */
    checkDelegation(tasks: Array<{ goal?: unknown; systemPrompt?: unknown; role?: unknown }>): ContentVerdict {
      if (options.mode === 'off') return { ok: true };
      const verdict = screenDelegation(tasks);
      if (!verdict.ok) {
        const decision: GuardDecision = { decision: options.mode === 'shadow' ? 'allow' : 'block', category: 'delegation', tier: 3, stage: 'hard_rule', reason: verdict.reason, rule: verdict.rule, latencyMs: 0, ...(options.mode === 'shadow' ? { shadow: { decision: 'block', reason: verdict.reason } } : {}) };
        record({ tool: 'delegate_to_subagents', args: { tasks: tasks.length } }, decision, 'agent');
        return options.mode === 'shadow' ? { ok: true } : verdict;
      }
      return verdict;
    },

    /** What a sub-agent returns: data for the master, with orders neutralised. */
    checkReturn(summary: string): string {
      if (options.mode === 'off') return summary;
      const screened = screenReturn(summary);
      if (screened.findings.length) {
        record({ tool: 'subagent_return', args: {} }, { decision: 'allow', category: 'delegation', tier: 3, stage: 'hard_rule', reason: `Consigne neutralisée dans le compte rendu (${screened.findings.map(finding => finding.rule).join(', ')}).`, rule: 'return_injection', latencyMs: 0 }, 'subagent');
      }
      return options.mode === 'enforce' ? screened.text : summary;
    },

    /** A skill or agent that would be shared. */
    checkShared(text: string): ContentVerdict {
      if (options.mode === 'off') return { ok: true };
      const verdict = screenSharedContent(text);
      if (!verdict.ok) record({ tool: 'shared_content', args: {} }, { decision: 'block', category: 'shared_content', tier: 3, stage: 'hard_rule', reason: verdict.reason, rule: verdict.rule, latencyMs: 0 }, 'agent');
      return verdict;
    },

    /** The entrance: a tool result from outside, neutralised before the agent reads it. */
    screenResult<T>(tool: string, result: T): T {
      if (options.mode === 'off') return result;
      const screened = screenToolResult(tool, result);
      if (screened.findings.length) {
        record({ tool, args: {} }, { decision: 'allow', category: 'read', tier: 1, stage: 'hard_rule', reason: `Contenu extérieur : ${screened.findings.length} consigne(s) neutralisée(s).`, rule: 'input_injection', latencyMs: 0 }, 'agent');
        return options.mode === 'enforce' ? screened.result : result;
      }
      return result;
    },

    /** Deletions already made in this run, for a guard resumed part-way. */
    noteDeletes(count: number) { deletes += Math.max(0, Math.floor(count)); },
    stats: () => ({ ...stats }),
    mode: options.mode,
  };
}
