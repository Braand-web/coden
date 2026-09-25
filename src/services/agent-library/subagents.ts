/**
 * Specialised sub-agents, run in parallel by the master agent.
 *
 * The master (the coder of the pipeline) decides alone when a task is worth
 * splitting. It calls `delegate_to_subagents` with one entry per independent
 * part — a role, a goal, the files that part owns — and each sub-agent runs
 * its own tool loop on the same sandbox, with its own system prompt, its own
 * tools and the model Auto would pick for its kind of work.
 *
 * Guardrails:
 * - depth 1: a sub-agent has no delegation tool;
 * - at most `maxParallel` sub-agents at once (CODEN_SUBAGENTS_MAX_PARALLEL);
 * - a token budget and a timeout per sub-agent;
 * - each writes only inside the files it was given; overlapping scopes are
 *   refused and handed back to the master to arbitrate;
 * - dependencies, the user and integrations stay with the master, the only
 *   one that talks to the user;
 * - a sub-agent that fails is run once more on a stronger model.
 */
import type { ModelTier } from './library.ts';

export type SubagentLimits = {
  maxParallel: number;
  maxTasks: number;
  tokenBudget: number;
  timeoutMs: number;
  maxToolCalls: number;
};

export function subagentLimits(env: Record<string, string | undefined> = process.env): SubagentLimits {
  const number = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
  };
  const maxParallel = number(env.CODEN_SUBAGENTS_MAX_PARALLEL, 5, 1, 8);
  return {
    maxParallel,
    maxTasks: maxParallel * 2,
    tokenBudget: number(env.CODEN_SUBAGENT_TOKEN_BUDGET, 400_000, 20_000, 2_000_000),
    timeoutMs: number(env.CODEN_SUBAGENT_TIMEOUT_MS, 6 * 60_000, 30_000, 20 * 60_000),
    maxToolCalls: number(env.CODEN_SUBAGENT_MAX_TOOL_CALLS, 60, 5, 200),
  };
}

export const SUBAGENT_READ_TOOLS = ['list_files', 'read_file', 'search_files', 'get_logs', 'web_search', 'fetch_url'];
export const SUBAGENT_WRITE_TOOLS = ['write_file', 'edit_file', 'delete_file'];
/* Commands can be granted (a tester running the tests); everything else stays with the master. */
export const SUBAGENT_OPTIONAL_TOOLS = ['run_command'];
export const SUBAGENT_TOOLS = [...SUBAGENT_READ_TOOLS, ...SUBAGENT_WRITE_TOOLS, ...SUBAGENT_OPTIONAL_TOOLS];

export type SubagentTask = {
  id: string;
  role: string;
  goal: string;
  /** Files ("src/App.tsx") and folders ("src/components/") this sub-agent owns. */
  scope: string[];
  tools: string[];
  modelTier: ModelTier;
  /** An agent from the library, reused as is. */
  libraryAgentId?: string;
  /** A new agent's own system prompt, when none from the library fits. */
  systemPrompt?: string;
  /** Offer this new agent to the shared library if its task succeeds. */
  saveToLibrary?: { name: string; description: string } | null;
};

export type SubagentStatus = 'queued' | 'running' | 'retrying' | 'done' | 'failed';

export type SubagentView = {
  id: string;
  role: string;
  status: SubagentStatus;
  progress: number;
  model?: string;
  scope: string[];
  summary?: string;
  error?: string;
};

export type SubagentOutcome = {
  ok: boolean;
  summary: string;
  filesChanged: string[];
  toolCalls: number;
  tokens: number;
  costUsd: number;
  stoppedBecause: string;
  model: string;
  error?: string;
};

/* ------------------------------------------------------------------------ */
/* Scopes                                                                    */
/* ------------------------------------------------------------------------ */

export function normalizeScopePath(value: string): string {
  const path = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (!path || path.includes('..')) return '';
  return path;
}

export function pathInScope(path: string, scope: string[]): boolean {
  const target = normalizeScopePath(path);
  if (!target) return false;
  return scope.some(entry => entry === target || (entry.endsWith('/') && target.startsWith(entry)));
}

function entriesOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.endsWith('/') && b.startsWith(a)) return true;
  if (b.endsWith('/') && a.startsWith(b)) return true;
  return false;
}

/** Pairs of sub-agents that would write the same file. */
export function scopeConflicts(tasks: Array<Pick<SubagentTask, 'id' | 'role' | 'scope'>>): Array<{ a: string; b: string; path: string }> {
  const conflicts: Array<{ a: string; b: string; path: string }> = [];
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      for (const left of tasks[i].scope) {
        const right = tasks[j].scope.find(entry => entriesOverlap(left, entry));
        if (right) { conflicts.push({ a: tasks[i].role, b: tasks[j].role, path: left.length >= right.length ? left : right }); break; }
      }
    }
  }
  return conflicts;
}

/* ------------------------------------------------------------------------ */
/* The delegation request                                                    */
/* ------------------------------------------------------------------------ */

const TIERS: ModelTier[] = ['fast', 'balanced', 'reasoning', 'design'];

export type ParsedDelegation = { ok: true; tasks: SubagentTask[] } | { ok: false; error: string };

export function parseDelegation(args: Record<string, unknown>, limits: SubagentLimits, knownAgents: (id: string) => boolean): ParsedDelegation {
  const raw = Array.isArray(args.tasks) ? args.tasks : [];
  if (!raw.length) return { ok: false, error: 'Aucune tâche : fournis au moins deux parties indépendantes à déléguer.' };
  if (raw.length > limits.maxTasks) return { ok: false, error: `Trop de sous-agents (${raw.length}) : ${limits.maxTasks} au plus par délégation, ${limits.maxParallel} en même temps.` };
  const tasks: SubagentTask[] = [];
  for (const [index, entry] of raw.entries()) {
    const item = (entry || {}) as Record<string, unknown>;
    const role = String(item.role || '').trim().slice(0, 80);
    const goal = String(item.goal || '').trim().slice(0, 6_000);
    const scope = [...new Set((Array.isArray(item.files) ? item.files : []).map(value => normalizeScopePath(String(value))).filter(Boolean))].slice(0, 60);
    if (!role || goal.length < 20) return { ok: false, error: `Tâche ${index + 1} : un rôle et un objectif précis sont nécessaires.` };
    if (!scope.length) return { ok: false, error: `Tâche ${index + 1} (${role}) : indique les fichiers ou dossiers qu’elle possède (files).` };
    if (scope.some(path => ['package.json', 'package-lock.json', '/'].includes(path) || path === '' )) {
      return { ok: false, error: `Tâche ${index + 1} (${role}) : package.json reste au maître. Installe toi-même les dépendances avant ou après la délégation.` };
    }
    const libraryAgentId = item.library_agent_id ? String(item.library_agent_id) : undefined;
    if (libraryAgentId && !knownAgents(libraryAgentId)) return { ok: false, error: `Tâche ${index + 1} : l’agent ${libraryAgentId} n’existe pas dans la bibliothèque (ou il est désactivé).` };
    const requestedTools = (Array.isArray(item.tools) ? item.tools : []).map(String).filter(tool => SUBAGENT_TOOLS.includes(tool));
    tasks.push({
      id: `sub-${index + 1}`,
      role,
      goal,
      scope,
      tools: [...new Set([...SUBAGENT_READ_TOOLS, ...SUBAGENT_WRITE_TOOLS, ...requestedTools])],
      modelTier: TIERS.includes(item.model_tier as ModelTier) ? item.model_tier as ModelTier : 'balanced',
      libraryAgentId,
      systemPrompt: item.system_prompt ? String(item.system_prompt).slice(0, 6_000) : undefined,
      saveToLibrary: item.save_to_library && typeof item.save_to_library === 'object'
        ? { name: String((item.save_to_library as any).name || role).slice(0, 80), description: String((item.save_to_library as any).description || '').slice(0, 400) }
        : null,
    });
  }
  const conflicts = scopeConflicts(tasks);
  if (conflicts.length) {
    return {
      ok: false,
      error: `Arbitrage nécessaire : ${conflicts.map(conflict => `« ${conflict.a} » et « ${conflict.b} » touchent tous deux ${conflict.path}`).join(' ; ')}. Attribue chaque fichier à un seul sous-agent, ou garde ce fichier pour toi et fais la modification après la délégation.`,
    };
  }
  return { ok: true, tasks };
}

/* ------------------------------------------------------------------------ */
/* Running them                                                              */
/* ------------------------------------------------------------------------ */

export type SubagentExecutor = (task: SubagentTask, attempt: 0 | 1, report: (patch: Partial<SubagentView>) => void) => Promise<SubagentOutcome>;

export async function runSubagents(input: {
  tasks: SubagentTask[];
  limits: SubagentLimits;
  execute: SubagentExecutor;
  onUpdate?: (views: SubagentView[]) => void;
  signal?: AbortSignal;
}): Promise<Array<{ task: SubagentTask; outcome: SubagentOutcome; attempts: number }>> {
  const views = new Map<string, SubagentView>(input.tasks.map(task => [task.id, { id: task.id, role: task.role, status: 'queued', progress: 0, scope: task.scope }]));
  const publish = () => input.onUpdate?.([...views.values()].map(view => ({ ...view })));
  const patch = (id: string, change: Partial<SubagentView>) => { views.set(id, { ...views.get(id)!, ...change }); publish(); };
  publish();

  const results: Array<{ task: SubagentTask; outcome: SubagentOutcome; attempts: number }> = [];
  const queue = [...input.tasks];
  const failure = (task: SubagentTask, error: unknown): SubagentOutcome => ({
    ok: false, summary: '', filesChanged: [], toolCalls: 0, tokens: 0, costUsd: 0, stoppedBecause: 'error', model: '', error: String((error as Error)?.message || error || 'échec').slice(0, 400),
  });

  const worker = async () => {
    while (queue.length) {
      input.signal?.throwIfAborted();
      const task = queue.shift()!;
      patch(task.id, { status: 'running', progress: 0.02 });
      let outcome = await input.execute(task, 0, change => patch(task.id, change)).catch(error => failure(task, error));
      let attempts = 1;
      if (!outcome.ok && !input.signal?.aborted) {
        patch(task.id, { status: 'retrying', progress: 0.05, error: outcome.error });
        const retry = await input.execute(task, 1, change => patch(task.id, change)).catch(error => failure(task, error));
        attempts = 2;
        outcome = {
          ...retry,
          filesChanged: [...new Set([...outcome.filesChanged, ...retry.filesChanged])],
          toolCalls: outcome.toolCalls + retry.toolCalls,
          tokens: outcome.tokens + retry.tokens,
          costUsd: outcome.costUsd + retry.costUsd,
        };
      }
      patch(task.id, { status: outcome.ok ? 'done' : 'failed', progress: 1, model: outcome.model, summary: outcome.summary.slice(0, 280), error: outcome.ok ? undefined : outcome.error });
      results.push({ task, outcome, attempts });
    }
  };
  await Promise.all(Array.from({ length: Math.min(input.limits.maxParallel, input.tasks.length) }, worker));
  return input.tasks.map(task => results.find(result => result.task.id === task.id)!).filter(Boolean);
}

/** What the master reads back: who did what, what changed, what to check. */
export function renderDelegationReport(results: Array<{ task: SubagentTask; outcome: SubagentOutcome; attempts: number }>): string {
  const lines = results.map(({ task, outcome, attempts }) => [
    `### ${task.role} — ${outcome.ok ? 'terminé' : 'échec'}${attempts > 1 ? ' (relancé sur un modèle plus puissant)' : ''}`,
    `Modèle : ${outcome.model || '—'} · ${outcome.toolCalls} appels d’outils · ${outcome.tokens.toLocaleString('fr-FR')} tokens`,
    outcome.filesChanged.length ? `Fichiers modifiés : ${outcome.filesChanged.join(', ')}` : 'Aucun fichier modifié.',
    outcome.summary ? `Compte rendu : ${outcome.summary}` : '',
    outcome.ok ? '' : `Erreur : ${outcome.error || outcome.stoppedBecause}`,
  ].filter(Boolean).join('\n'));
  return [
    '## Résultat de la délégation',
    ...lines,
    '',
    'À toi maintenant : relis les fichiers modifiés, vérifie qu’ils s’emboîtent (imports, props, types, routes), installe les dépendances qu’ils demandent, corrige ce qui manque, puis continue. Les sous-agents ne parlent pas à l’utilisateur : c’est toi qui lui rends compte.',
  ].join('\n\n');
}
