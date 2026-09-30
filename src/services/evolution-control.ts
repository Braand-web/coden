/**
 * The control of self-improvement: what the agents may change by themselves, how much, and how a change is judged.
 *
 * The agents improve their own skills, sub-agents, prompts, routing rules and catalogues without asking anyone; what
 * keeps that safe is this file — limits that are fixed in code, not an approval queue:
 *
 *  - a global freeze (`CODEN_EVOLUTION_FREEZE=1`) that stops every change at once;
 *  - a protected core that no change may touch — cost ceilings, security and isolation, permissions, plans and
 *    billing, and this control itself. A change that would touch it is abandoned and journaled, nobody is asked;
 *  - a daily ceiling on the number of changes (`CODEN_EVOLUTION_MAX_PER_DAY`, 5 by default);
 *  - an adoption rule: a change is kept only when it measurably beats what it replaces, with no new regression
 *    and no rise in cost; otherwise it is rolled back.
 *
 * Changes to Coden's own code are never adopted by this mechanism. They can be proposed on a branch, and the
 * merge and the deployment to production stay a person's decision: a deployment is an irreversible act with a
 * real effect, which is the one thing Coden does not do on its own.
 */
import { screenSharedContent } from './action-guard/screen.ts';

export type EvolutionKind = 'skill' | 'subagent' | 'prompt' | 'routing' | 'catalog' | 'code';

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (typeof process !== 'undefined' ? process.env : {});

/** Everything stops. */
export function evolutionFrozen(env: Env = processEnv()): boolean {
  return env.CODEN_EVOLUTION_FREEZE === '1' || env.CODEN_AGENT_EVOLUTION === '0';
}

export function evolutionDailyCeiling(env: Env = processEnv()): number {
  const value = Number(env.CODEN_EVOLUTION_MAX_PER_DAY);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 5;
}

/** The protected core: written by the owner of Coden, out of reach of any change the agents make. */
export const PROTECTED_CORE: ReadonlyArray<{ id: string; why: string; path: RegExp; words: RegExp }> = [
  { id: 'cost_ceilings', why: 'Plafonds de coût', path: /(?:^|\/)(?:budget|spend|cap|quota|credit|usage)[\w.-]*\.(?:ts|tsx|sql)$|services\/(?:provider-balance|openrouter-balance)/i, words: /\b(?:cost ceiling|spending cap|budget cap|credit cap|plafond de co[uû]t|hard cap)\b/i },
  { id: 'security_isolation', why: 'Règles de sécurité, de confidentialité et d\'isolation', path: /action-guard\/|sandbox\/(?:project-sandbox|isolation|preview-proxy|command-policy|e2b)|(?:^|\/)secrets?[\w.-]*\.ts$|(?:^|\/)auth[\w.-]*\.ts$|supabase\/migrations\/.*(?:rls|policy|policies)/i, words: /\b(?:action[- ]guard|sandbox isolation|isolat(?:e|ion) of (?:sessions|the preview)|bypass (?:the )?(?:guard|sandbox|rls)|disable (?:rls|the guard)|service[_ ]role)\b/i },
  { id: 'permissions', why: 'Permissions et droits d\'action des agents', path: /(?:^|\/)(?:permissions?|tool-policy|capabilit(?:y|ies))[\w.-]*\.ts$|agent-policy/i, words: /\b(?:grant (?:itself|the agent)|extra permissions?|elevat(?:e|ed) privileges?|droits? d['’]action)\b/i },
  { id: 'plans_billing', why: 'Plans d\'abonnement et facturation', path: /(?:^|\/)(?:billing|pricing|plans?|stripe|saspay|invoice)[\w.-]*\.(?:ts|tsx|sql)$|config\/billing|supabase\/migrations\/.*(?:billing|pricing|credit)/i, words: /\b(?:change (?:the )?(?:price|plan|billing)|abonnements?|facturation|free credits?|crédits? gratuits?)\b.*\b(?:modifie|change|edit|update)\b/i },
  { id: 'evolution_control', why: 'Le système de contrôle de l\'évolution lui-même', path: /evolution-control|agent-library\/(?:store|library)\.ts$|\.github\/|railway\.|Dockerfile|scripts\/(?:deploy|rollback)/i, words: /\b(?:evolution[- ]control|evolution freeze|CODEN_EVOLUTION|rollback mechanism|journal d['’]évolution)\b/i },
];

export function touchesProtectedCore(input: { paths?: string[]; text?: string }): { id: string; why: string } | null {
  for (const rule of PROTECTED_CORE) {
    if ((input.paths || []).some(path => rule.path.test(String(path).replace(/\\/g, '/')))) return { id: rule.id, why: rule.why };
    if (input.text && rule.words.test(input.text)) return { id: rule.id, why: rule.why };
  }
  return null;
}

export type EvolutionVerdict = { allowed: boolean; reason: string; rule?: string; mode?: 'adopt' | 'proposal' };

/** May this change be made at all? Cheap, deterministic, and checked before anything is tried. */
export function checkEvolutionChange(input: { kind: EvolutionKind; paths?: string[]; text?: string; changesToday: number }, env: Env = processEnv()): EvolutionVerdict {
  if (evolutionFrozen(env)) return { allowed: false, reason: 'L\'évolution est gelée (interrupteur global).', rule: 'freeze' };
  const core = touchesProtectedCore(input);
  if (core) return { allowed: false, reason: `Hors de portée : ${core.why}.`, rule: core.id };
  if (input.kind === 'code') return { allowed: true, mode: 'proposal', reason: 'Un changement de code est proposé sur une branche ; sa mise en production reste une décision humaine.' };
  if (input.changesToday >= evolutionDailyCeiling(env)) return { allowed: false, reason: `Plafond quotidien de changements atteint (${evolutionDailyCeiling(env)}).`, rule: 'daily_ceiling' };
  if (input.text) {
    const screened = screenSharedContent(input.text);
    if (!screened.ok) return { allowed: false, reason: screened.reason, rule: screened.rule };
  }
  return { allowed: true, mode: 'adopt', reason: 'Dans le périmètre.' };
}

export type Measure = { score: number; regressions: number; costUsd: number };

/** Adopt only what is measurably better, with no new regression and no dearer; anything else is rolled back. */
export function decideAdoption(input: { baseline: Measure; candidate: Measure; minGain?: number; costTolerance?: number }): { adopt: boolean; reason: string } {
  const minGain = input.minGain ?? 0.02;
  const tolerance = input.costTolerance ?? 0.1;
  const { baseline, candidate } = input;
  if (candidate.regressions > baseline.regressions) return { adopt: false, reason: `Annulé : ${candidate.regressions - baseline.regressions} régression(s) de plus.` };
  if (baseline.costUsd > 0 && candidate.costUsd > baseline.costUsd * (1 + tolerance)) return { adopt: false, reason: 'Annulé : le coût monte de plus de 10 %.' };
  if (candidate.score < baseline.score + minGain) return { adopt: false, reason: candidate.score < baseline.score ? 'Annulé : le score baisse.' : 'Annulé : pas de gain mesurable.' };
  return { adopt: true, reason: `Adopté : score ${baseline.score.toFixed(2)} → ${candidate.score.toFixed(2)}, sans régression.` };
}

/**
 * A version that has been used enough and does clearly worse than the one it replaced goes back: the parent is
 * restored, the child is switched off. Judged on real runs, on each version's own success rate.
 */
export function shouldRollBackVersion(child: { uses: number; successes: number }, parent: { uses: number; successes: number } | null, options: { minUses?: number; margin?: number } = {}): boolean {
  const minUses = options.minUses ?? 5;
  if (!parent || child.uses < minUses || parent.uses < minUses) return false;
  return child.successes / child.uses < parent.successes / parent.uses - (options.margin ?? 0.1);
}

/** One line of the evolution journal: why, what was measured, which version. */
export function evolutionJournalLine(entry: { kind: EvolutionKind; target: string; decision: 'adopted' | 'rolled_back' | 'blocked' | 'proposed'; reason: string; rule?: string; baseline?: Measure; candidate?: Measure; version?: number }) {
  return { at: new Date().toISOString(), ...entry };
}
