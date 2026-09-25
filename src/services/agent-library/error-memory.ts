/**
 * The error memory: never make the same mistake twice.
 *
 * Every error a session meets (build, runtime, failed test, a wrong move,
 * a correction the user had to ask for) is recorded with its cause and the
 * fix that worked, as a generic rule. A rule is used only once its fix was
 * confirmed (the build or the tests passed, or the user validated it), and it
 * is then given to the master agent and every sub-agent before they write
 * code — in every session, for every user.
 *
 * Pure rules here; persistence is in `store.ts`.
 */
import { anonymizeText, errorSignature } from '../agent-learning.ts';
import { cosineSimilarity, type EmbeddingVector } from '../embeddings.ts';

export type ErrorCategory = 'build' | 'runtime' | 'test' | 'mishandling' | 'user_correction';
export type ErrorStatus = 'candidate' | 'active' | 'needs_review' | 'disabled';

export type ErrorMemory = {
  id: string;
  signature: string;
  category: ErrorCategory;
  error_message: string;
  context: { libraries?: Record<string, number>; stack?: string[]; source?: string };
  cause: string;
  fix: string;
  rule: string;
  status: ErrorStatus;
  permanent: boolean;
  occurrences: number;
  confirmations: number;
  recurrences_after_rule: number;
  skill_id: string | null;
  contributors: string[];
  embedding: EmbeddingVector | null;
  edited_by_admin: boolean;
  last_seen_at: string;
  last_recurrence_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ErrorObservation = {
  category: ErrorCategory;
  message: string;
  /** Library the error concerns (package name), when known. */
  library?: string;
  /** Libraries of the project, name → major version. */
  libraries?: Record<string, number>;
  source?: string;
  cause?: string;
  fix?: string;
  rule?: string;
};

/** Occurrences (with a confirmed fix) after which a rule is always applied for its stack. */
export const PERMANENT_AFTER = 3;

const CATEGORIES: ErrorCategory[] = ['build', 'runtime', 'test', 'mishandling', 'user_correction'];

export function normalizeCategory(value: unknown): ErrorCategory {
  return CATEGORIES.includes(value as ErrorCategory) ? value as ErrorCategory : 'build';
}

/** Name → major version, from a package.json. */
export function librariesFromPackageJson(content: string | undefined): Record<string, number> {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    const all = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) } as Record<string, string>;
    return Object.fromEntries(Object.entries(all).map(([name, range]) => [name, Number(/(\d+)/.exec(String(range))?.[1] ?? NaN)]).filter(([, major]) => Number.isFinite(major))) as Record<string, number>;
  } catch {
    return {};
  }
}

/** The package an error message is about, when it names one. */
export function libraryInMessage(message: string, libraries: Record<string, number>): string | undefined {
  const names = Object.keys(libraries).sort((a, b) => b.length - a.length);
  const text = String(message || '');
  return names.find(name => text.includes(`'${name}'`) || text.includes(`"${name}"`) || text.includes(`${name}/`) || new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\/@]/g, '\\$&')}\\b`).test(text));
}

/**
 * One entry for "the same error": the category, the library it concerns and
 * the message with every path, number, name and literal removed. Two errors
 * that differ only by a file name or a line number land on one signature.
 */
export function memorySignature(observation: Pick<ErrorObservation, 'category' | 'message' | 'library'>): string {
  // Any file name, however short its path, is not part of the error.
  const message = String(observation.message || '').replace(/<file\.[a-z0-9]+>(?:\(\d+(?:,\d+)?\))?/gi, '<file>').replace(/(?:[\w@.~-]+\/)*[\w@.-]+\.(?:tsx?|jsx?|mjs|cjs|css|scss|json|vue|svelte|astro|html|md)\b(?:[(:]\d+(?:[,:]\d+)?\)?)?/gi, '<file>');
  const base = errorSignature(message)
    .replace(/'<x>'/g, "'…'")
    .replace(/<<file>>|<file\.[a-z0-9]+>/g, '<file>')
    .slice(0, 180);
  return `${observation.category}|${observation.library || '-'}|${base}`;
}

const cleanRule = (value: unknown, max: number) => anonymizeText(String(value ?? '').replace(/\s+/g, ' ').trim(), max);

/** What is kept: the technical cause and the generic fix, anonymised. */
export function sanitizeObservation(observation: ErrorObservation): ErrorObservation {
  const libraries = observation.library && observation.libraries?.[observation.library] !== undefined
    ? { [observation.library]: observation.libraries[observation.library] }
    : {};
  return {
    category: normalizeCategory(observation.category),
    message: anonymizeText(observation.message, 300),
    library: observation.library,
    libraries,
    source: observation.source ? anonymizeText(observation.source, 40) : undefined,
    cause: cleanRule(observation.cause, 400),
    fix: cleanRule(observation.fix, 500),
    rule: cleanRule(observation.rule, 400),
  };
}

export type Applicability = 'apply' | 'review' | 'skip';

/**
 * Whether a rule applies to this project.
 *
 * A rule learnt on a library at one major version is not applied blindly to
 * another: it is shown as "to re-check". A rule about a library the project
 * does not use is skipped.
 */
export function applicability(memory: Pick<ErrorMemory, 'context' | 'status'>, projectLibraries: Record<string, number>): Applicability {
  if (memory.status === 'disabled' || memory.status === 'candidate') return 'skip';
  const libraries = memory.context?.libraries || {};
  const names = Object.keys(libraries);
  if (!names.length) return memory.status === 'needs_review' ? 'review' : 'apply';
  const known = names.filter(name => projectLibraries[name] !== undefined);
  // A project whose dependencies are not known yet (a new one): nothing contradicts the rule.
  if (!known.length) return Object.keys(projectLibraries).length ? 'skip' : memory.status === 'needs_review' ? 'review' : 'apply';
  if (known.some(name => projectLibraries[name] !== libraries[name])) return 'review';
  return memory.status === 'needs_review' ? 'review' : 'apply';
}

export type RankedMemory = { memory: ErrorMemory; applies: Applicability; score: number };

/**
 * The rules to give an agent before it works: permanent rules for the
 * project's stack first, then the closest ones to the task.
 */
export function rankMemories(memories: ErrorMemory[], query: EmbeddingVector | null, projectLibraries: Record<string, number>, limit = 8): RankedMemory[] {
  const ranked: RankedMemory[] = [];
  for (const memory of memories) {
    const applies = applicability(memory, projectLibraries);
    if (applies === 'skip') continue;
    const similarity = query && memory.embedding?.length ? cosineSimilarity(query, memory.embedding) : 0;
    const stackMatch = Object.keys(memory.context?.libraries || {}).some(name => projectLibraries[name] !== undefined) ? 0.25 : 0;
    const weight = (memory.permanent ? 1 : 0) + stackMatch + similarity + Math.min(0.3, memory.recurrences_after_rule * 0.1) + Math.min(0.2, memory.occurrences * 0.02);
    if (!memory.permanent && similarity < 0.15 && !stackMatch) continue;
    ranked.push({ memory, applies, score: weight });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function ruleText(memory: Pick<ErrorMemory, 'rule' | 'cause' | 'fix' | 'error_message' | 'context'>): string {
  const library = Object.entries(memory.context?.libraries || {}).map(([name, major]) => `${name} v${major}`).join(', ');
  const base = memory.rule || `Éviter : ${memory.cause || memory.error_message}. Faire : ${memory.fix}`;
  return library ? `Avec ${library} : ${base}` : base;
}

export function renderErrorRules(ranked: RankedMemory[]): string {
  if (!ranked.length) return '';
  const lines = ranked.map(({ memory, applies }) => {
    const important = memory.permanent || memory.recurrences_after_rule > 0;
    const prefix = applies === 'review' ? '[À REVÉRIFIER — version différente] ' : important ? '[IMPORTANT] ' : '';
    return `- ${prefix}${ruleText(memory)} (erreur évitée : « ${memory.error_message.slice(0, 140)} »)`;
  });
  return [
    '## Règles apprises des erreurs déjà rencontrées',
    'Ces erreurs se sont produites dans d’autres sessions et leur correction a été confirmée. Applique ces règles avant d’écrire ; une règle « à revérifier » concernait une autre version : vérifie qu’elle vaut encore.',
    ...lines,
  ].join('\n');
}

/** How the memory changes when the same error is seen again. */
export function observe(existing: ErrorMemory, input: { confirmed: boolean; ruleWasGiven: boolean; libraries: Record<string, number>; contributor: string | null; now: string }): Partial<ErrorMemory> {
  const occurrences = existing.occurrences + 1;
  const confirmations = existing.confirmations + (input.confirmed ? 1 : 0);
  const recurrence = input.ruleWasGiven;
  // Same library at another major version than the one the rule was learnt on: re-check it.
  const learnt = existing.context?.libraries || {};
  const versionChanged = Object.entries(learnt).some(([name, major]) => input.libraries[name] !== undefined && input.libraries[name] !== major);
  let status: ErrorStatus = existing.status;
  if (existing.status !== 'disabled') {
    if (versionChanged) status = 'needs_review';
    else if (input.confirmed && existing.status === 'candidate') status = 'active';
  }
  return {
    occurrences,
    confirmations,
    status,
    permanent: existing.permanent || (confirmations >= 2 && occurrences >= PERMANENT_AFTER) || existing.recurrences_after_rule + (recurrence ? 1 : 0) >= 2,
    recurrences_after_rule: existing.recurrences_after_rule + (recurrence ? 1 : 0),
    last_recurrence_at: recurrence ? input.now : existing.last_recurrence_at,
    contributors: input.contributor && !existing.contributors.includes(input.contributor) ? [...existing.contributors, input.contributor].slice(-200) : existing.contributors,
    last_seen_at: input.now,
  };
}
