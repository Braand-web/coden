/**
 * The master agent's team: three tools it gets on top of the sandbox's.
 *
 * - `delegate_to_subagents` runs specialised sub-agents in parallel (see
 *   subagents.ts for the guardrails);
 * - `save_skill` writes down a reusable method once a task is solved;
 * - `record_error_lesson` notes a mistake and its fix (a wrong command, a
 *   deleted file, a bad config) — build and test errors are recorded
 *   automatically.
 *
 * What the tools create is held in the run's `LibrarySession` and only
 * reaches the shared library when the run succeeds (store.settle).
 */
import type { ProviderGateway } from '../provider-gateway.ts';
import type { ProviderRequestConfig } from '../provider-adapters.ts';
import type { ChatMessage } from '../openrouter-service.ts';
import type { AllowedModelId } from '../../config/ai-models.ts';
import { MODEL_REGISTRY } from '../../config/ai-models.ts';
import { runLlmToolLoop, type AgentLoopSpend } from '../llm-tool-loop.ts';
import { selectModel, type TaskComplexity, type TaskKind } from '../model-selection.ts';
import { withUserInstructions } from '../agent-personalization.ts';
import { normalizeAgentDefinition, normalizeSkillDefinition, type AgentDefinition, type ModelTier } from './library.ts';
import { normalizeCategory } from './error-memory.ts';
import type { AgentLibraryStore, LibrarySession } from './store.ts';
import {
  parseDelegation,
  pathInScope,
  renderDelegationReport,
  runSubagents,
  SUBAGENT_TOOLS,
  SUBAGENT_WRITE_TOOLS,
  type SubagentLimits,
  type SubagentOutcome,
  type SubagentTask,
  type SubagentView,
} from './subagents.ts';

export type ToolSchema = { name: string; description: string; parameters: Record<string, unknown> };

export const TEAM_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'delegate_to_subagents',
    description: 'Run specialised sub-agents IN PARALLEL on independent parts of the work (e.g. UI screens, data layer, tests), then get their reports back. Use it only when the task is large and splits into parts that touch different files; for a small change, do it yourself. Each part owns a list of files or folders ("src/components/", "src/lib/api.ts") and may write only there: never give two parts the same file. Dependencies (package.json) stay with you: install them yourself. Reuse an agent from the library by its id when one fits. After they finish, YOU check that the parts fit together and fix the seams.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', description: 'Precise role, e.g. "Expert UI", "Expert base de données", "Testeur", "Revue de sécurité".' },
              goal: { type: 'string', description: 'What this sub-agent must deliver, precisely, with the interfaces it must respect (props, types, routes, table names).' },
              files: { type: 'array', items: { type: 'string' }, description: 'Files and folders (ending with /) this sub-agent owns and may write.' },
              model_tier: { type: 'string', enum: ['fast', 'balanced', 'reasoning', 'design'], description: 'fast: simple edits; balanced: ordinary code; reasoning: data, security, architecture; design: interface work.' },
              tools: { type: 'array', items: { type: 'string', enum: SUBAGENT_TOOLS }, description: 'Extra tools; reading and writing its own files are always allowed. run_command for a tester.' },
              library_agent_id: { type: 'string', description: 'Id of a sub-agent from the library to reuse.' },
              system_prompt: { type: 'string', description: 'For a new sub-agent: its dedicated system prompt (expertise, method, quality bar). Generic: no user data.' },
              save_to_library: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, description: 'Offer this new sub-agent to the shared library if it succeeds (generic definitions only).' },
            },
            required: ['role', 'goal', 'files'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'save_skill',
    description: 'Save a reusable skill once you have SOLVED a task that is likely to come back (e.g. "Intégrer Stripe", "Créer un dashboard admin", "Configurer l’auth Supabase"). It enters the shared library only if this run succeeds. Write it generically: no user names, keys, URLs, business data or project content. To improve an existing skill from the library, pass its id in improves_skill_id.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string', description: 'One sentence: what it does.' },
        when_to_use: { type: 'string' },
        instructions: { type: 'string', description: 'Detailed, ordered steps and best practices.' },
        examples: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, language: { type: 'string' }, code: { type: 'string' } }, required: ['title', 'code'] } },
        dependencies: { type: 'array', items: { type: 'string' }, description: 'npm packages, with a version range when it matters.' },
        improves_skill_id: { type: 'string' },
      },
      required: ['name', 'description', 'when_to_use', 'instructions'],
    },
  },
  {
    name: 'record_error_lesson',
    description: 'Record a mistake and the fix that worked, so no session repeats it: a wrong command, a file deleted by mistake, a wrong configuration, or a correction the user had to ask for. Build and test errors you fix are recorded automatically; use this for the others. Generic cause and fix only, no user data.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['build', 'runtime', 'test', 'mishandling', 'user_correction'] },
        error_message: { type: 'string' },
        cause: { type: 'string' },
        fix: { type: 'string' },
        rule: { type: 'string', description: 'The rule to follow next time, e.g. "Avec supabase-js v2, ne pas utiliser X : cause Y. Utiliser Z."' },
        library: { type: 'string', description: 'npm package concerned, if any.' },
      },
      required: ['category', 'error_message', 'cause', 'fix', 'rule'],
    },
  },
];

export const TEAM_TOOL_NAMES = new Set(TEAM_TOOL_SCHEMAS.map(tool => tool.name));

/** What the master is told about its team, in its system message. */
export function teamBriefing(limits: SubagentLimits): string {
  return `ÉQUIPE : pour une tâche vaste qui se découpe en parties indépendantes (écrans, couche de données, tests, revue de sécurité), tu peux lancer jusqu'à ${limits.maxParallel} sous-agents spécialisés en parallèle avec delegate_to_subagents. Donne à chacun un rôle précis, un objectif avec les interfaces à respecter, et ses propres fichiers. Tu restes responsable du résultat : tu vérifies et assembles leurs livrables, et tu es le seul à parler à l'utilisateur. Pour une petite tâche, travaille seul. Quand tu as résolu un problème qui reviendra, enregistre la méthode avec save_skill ; quand tu as corrigé une erreur de manipulation, note-la avec record_error_lesson.`;
}

const TIER_TASK: Record<ModelTier, { task: TaskKind; complexity: TaskComplexity }> = {
  fast: { task: 'code_edit', complexity: 'simple' },
  balanced: { task: 'code_generation', complexity: 'medium' },
  reasoning: { task: 'architecture', complexity: 'complex' },
  design: { task: 'design', complexity: 'medium' },
};
const STRONGER: Record<TaskComplexity, TaskComplexity> = { simple: 'complex', medium: 'complex', complex: 'extreme', extreme: 'extreme' };

export type TeamDeps = {
  gateway: ProviderGateway;
  store: AgentLibraryStore | null;
  session: LibrarySession | null;
  limits: SubagentLimits;
  plan: string;
  credits?: number;
  pinnedModel?: AllowedModelId;
  runtimeFor: (modelId: AllowedModelId) => ProviderRequestConfig;
  deadline: number;
  signal?: AbortSignal;
  /** Error rules and skills for this task, given to every sub-agent too. */
  libraryBlock?: string;
  designPolicy?: string;
  onSubagents?: (views: SubagentView[]) => void;
  onSpend?: (spend: AgentLoopSpend) => void | Promise<unknown>;
  /** Scrubs the project's secret values from every tool result a sub-agent reads. */
  redact?: (text: string) => string;
};

export type SandboxAccess = {
  schemas: ToolSchema[];
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

const labelOf = (modelId: string) => MODEL_REGISTRY.find(model => model.id === modelId)?.label || modelId;

export function modelForSubagent(task: Pick<SubagentTask, 'modelTier'>, attempt: 0 | 1, deps: Pick<TeamDeps, 'plan' | 'credits' | 'pinnedModel'>): { modelId: AllowedModelId; reasoningLevel: any } {
  const base = TIER_TASK[task.modelTier] || TIER_TASK.balanced;
  if (attempt === 0 && deps.pinnedModel) return { modelId: deps.pinnedModel, reasoningLevel: undefined };
  const selection = selectModel({
    task: base.task,
    complexity: attempt === 0 ? base.complexity : STRONGER[base.complexity],
    plan: deps.plan,
    credits: deps.credits,
    needs: { tools: true },
    interactive: true,
  });
  return { modelId: selection.modelId as AllowedModelId, reasoningLevel: selection.reasoningLevel };
}

function subagentSystemPrompt(task: SubagentTask, definition: AgentDefinition | null, deps: TeamDeps): string {
  const expertise = definition?.systemPrompt || task.systemPrompt || `Tu es « ${task.role} », un développeur senior spécialiste de ce rôle. Tu livres du code complet, typé, accessible et prêt pour la production.`;
  return withUserInstructions([
    expertise,
    '',
    `Tu es un sous-agent de Coden, lancé par l’agent maître pour une partie du travail. Ton périmètre, les seuls fichiers que tu peux créer, modifier ou supprimer : ${task.scope.join(', ')}.`,
    'Règles : lis ce dont tu as besoin partout, mais n’écris que dans ton périmètre. Si une modification ailleurs est nécessaire (un import à ajouter, une route, une dépendance), ne la fais pas : écris-la dans ton compte rendu, le maître s’en charge. N’installe aucune dépendance : liste celles qu’il faut. Tu ne parles pas à l’utilisateur et tu ne délègues pas. Travaille en peu d’étapes complètes, en groupant les appels d’outils indépendants.',
    'Termine par un compte rendu bref : ce que tu as livré, les fichiers, les dépendances nécessaires, les interfaces exposées (exports, props, types) et ce que le maître doit vérifier.',
    deps.designPolicy && (task.modelTier === 'design' || /ui|interface|design|écran|front/i.test(task.role)) ? `\n${deps.designPolicy}` : '',
    deps.libraryBlock ? `\n${deps.libraryBlock}` : '',
  ].filter(Boolean).join('\n'));
}

export function createAgentTeam(deps: TeamDeps) {
  const executeSubagent = (sandbox: SandboxAccess) => async (task: SubagentTask, attempt: 0 | 1, report: (patch: Partial<SubagentView>) => void): Promise<SubagentOutcome> => {
    const libraryItem = task.libraryAgentId ? deps.session?.agents.get(task.libraryAgentId) || await deps.store?.agent(task.libraryAgentId) || null : null;
    const definition = libraryItem ? libraryItem.definition as AgentDefinition : null;
    const tier = definition?.modelTier || task.modelTier;
    const { modelId } = modelForSubagent({ modelTier: tier }, attempt, deps);
    report({ model: labelOf(modelId), progress: 0.05 });

    const allowed = new Set([...task.tools, ...(definition?.tools || [])]);
    const schemas = sandbox.schemas.filter(schema => allowed.has(schema.name) && SUBAGENT_TOOLS.includes(schema.name));
    const filesChanged = new Set<string>();
    let toolCalls = 0;
    const handlers = Object.fromEntries(schemas.map(schema => [schema.name, async (args: Record<string, unknown>) => {
      deps.signal?.throwIfAborted();
      toolCalls += 1;
      report({ progress: Math.min(0.95, 0.08 + toolCalls / deps.limits.maxToolCalls) });
      if (SUBAGENT_WRITE_TOOLS.includes(schema.name)) {
        const path = String(args.path || '');
        if (!pathInScope(path, task.scope)) {
          return { ok: false, error: `« ${path} » est hors de ton périmètre (${task.scope.join(', ')}). Ne l’écris pas : décris la modification dans ton compte rendu, le maître s’en chargera.` };
        }
      }
      const result = await sandbox.call(schema.name, args);
      if ((result as any)?.ok === true && SUBAGENT_WRITE_TOOLS.includes(schema.name) && typeof args.path === 'string') filesChanged.add(args.path);
      return result;
    }]));

    const messages: ChatMessage[] = [
      { role: 'system', content: subagentSystemPrompt(task, definition, deps) },
      { role: 'user', content: `Ta mission (${task.role}) :\n${task.goal}\n\nTon périmètre : ${task.scope.join(', ')}` },
    ];
    const deadline = Math.min(deps.deadline, Date.now() + deps.limits.timeoutMs);
    try {
      const loop = await runLlmToolLoop({
        gateway: deps.gateway,
        modelId,
        messages,
        handlers,
        redact: deps.redact,
        runtimeConfig: {
          ...deps.runtimeFor(modelId),
          tools: schemas.map(schema => ({ type: 'function', function: { name: schema.name, description: schema.description, parameters: schema.parameters } })),
          toolChoice: 'auto',
        } as any,
        runtimeConfigForModel: deps.runtimeFor,
        allowFallback: !deps.pinnedModel || attempt === 1,
        maxModelAttempts: 2,
        maxToolCalls: deps.limits.maxToolCalls,
        maxSteps: Math.max(6, Math.min(30, deps.limits.maxToolCalls)),
        budget: { maxDurationMs: deps.limits.timeoutMs, maxTokens: deps.limits.tokenBudget },
        deadline,
        signal: deps.signal,
      });
      await deps.onSpend?.(loop.spend);
      const tokens = loop.spend.promptTokens + loop.spend.completionTokens;
      const summary = String(loop.result?.text || '').trim();
      const finished = loop.spend.stoppedBecause === 'answered';
      const ok = finished || (filesChanged.size > 0 && loop.spend.stoppedBecause !== 'step_budget');
      return {
        ok,
        summary: summary.slice(0, 2_000),
        filesChanged: [...filesChanged],
        toolCalls,
        tokens,
        costUsd: loop.spend.costUsd,
        stoppedBecause: loop.spend.stoppedBecause,
        model: labelOf(modelId),
        error: ok ? undefined : ({ token_budget: 'budget de tokens épuisé', time_budget: 'délai dépassé', tool_budget: 'trop d’appels d’outils', step_budget: 'n’a pas terminé' } as Record<string, string>)[loop.spend.stoppedBecause] || loop.spend.stoppedBecause,
      };
    } catch (error: any) {
      return { ok: false, summary: '', filesChanged: [...filesChanged], toolCalls, tokens: 0, costUsd: 0, stoppedBecause: 'error', model: labelOf(modelId), error: String(error?.message || error).slice(0, 300) };
    }
  };

  return {
    schemas: TEAM_TOOL_SCHEMAS,
    async handle(name: string, args: Record<string, unknown>, sandbox: SandboxAccess): Promise<unknown> {
      if (name === 'delegate_to_subagents') {
        const parsed = parseDelegation(args, deps.limits, id => Boolean(deps.session?.agents.has(id)));
        if (!parsed.ok) return { ok: false, error: parsed.error };
        const results = await runSubagents({
          tasks: parsed.tasks,
          limits: deps.limits,
          execute: executeSubagent(sandbox),
          onUpdate: deps.onSubagents,
          signal: deps.signal,
        });
        // What the library learns from this delegation.
        for (const { task, outcome } of results) {
          if (task.libraryAgentId) {
            deps.session?.usedItemIds.add(task.libraryAgentId);
            deps.session?.itemOutcomes.set(task.libraryAgentId, outcome.ok);
          } else if (task.saveToLibrary && task.systemPrompt && deps.session) {
            deps.session.candidates.push({
              kind: 'agent',
              name: task.saveToLibrary.name,
              description: task.saveToLibrary.description || task.role,
              definition: normalizeAgentDefinition({ role: task.role, systemPrompt: task.systemPrompt, tools: task.tools, modelTier: task.modelTier, scopeHint: task.scope.find(entry => entry.endsWith('/')) }, SUBAGENT_TOOLS),
              tags: [task.modelTier],
              succeeded: outcome.ok,
            });
          }
        }
        return { ok: results.some(result => result.outcome.ok), report: renderDelegationReport(results) };
      }
      if (name === 'save_skill') {
        if (!deps.session) return { ok: false, error: 'La bibliothèque n’est pas disponible pour cette session.' };
        const definition = normalizeSkillDefinition({
          whenToUse: args.when_to_use as string,
          instructions: args.instructions as string,
          examples: args.examples as any,
          dependencies: args.dependencies as any,
        });
        deps.session.candidates.push({
          kind: 'skill',
          name: String(args.name || '').slice(0, 80),
          description: String(args.description || '').slice(0, 400),
          definition,
          tags: definition.dependencies.map(dependency => dependency.replace(/(?<=.)@.*$/, '')).slice(0, 8),
          improves: args.improves_skill_id ? String(args.improves_skill_id) : null,
        });
        return {
          ok: true,
          note: deps.session.shareAllowed
            ? 'Skill noté. Il rejoindra la bibliothèque partagée si cette session réussit (build et vérifications OK).'
            : 'Skill noté pour cette session. L’utilisateur a désactivé le partage : il ne rejoindra pas la bibliothèque partagée.',
        };
      }
      if (name === 'record_error_lesson') {
        if (!deps.session) return { ok: false, error: 'La mémoire des erreurs n’est pas disponible pour cette session.' };
        deps.session.errors.push({
          category: normalizeCategory(args.category),
          message: String(args.error_message || ''),
          cause: String(args.cause || ''),
          fix: String(args.fix || ''),
          rule: String(args.rule || ''),
          library: args.library ? String(args.library) : undefined,
          libraries: deps.session.projectLibraries,
          source: 'agent',
        });
        return { ok: true, note: 'Leçon notée. Elle sera validée si la session se termine avec succès.' };
      }
      return { ok: false, error: `Outil inconnu : ${name}` };
    },
  };
}

export type AgentTeam = ReturnType<typeof createAgentTeam>;
