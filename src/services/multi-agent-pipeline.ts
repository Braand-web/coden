/**
 * The whole pipeline, for the route to call as one thing.
 *
 * `server.ts` cannot import from itself as a module — it is an entrypoint
 * script, not a library — so this owns the composition the new `/generate`
 * branch needs: plan when the route calls for one, bring the sandbox up
 * (real filesystem, real `npm install`, real dev server), then drive
 * `runCoderLoop` in `'build'` mode against it. Building already reviews and
 * repairs itself — round one writes, later rounds fix what the toolchain
 * still complains about — so nothing here runs a second, redundant repair
 * pass on top; `reviewer-agent.ts` exists for the callers that are not
 * coming out of a build that already did that.
 *
 * `started: false` is the one signal the route needs to fall back to the
 * legacy blob path safely: the sandbox itself never came up (capacity, an
 * install failure), so nothing was written and nothing needs to be undone.
 * Every other failure — the planner exhausting its one repair attempt, a
 * provider outage — is left to throw, because guessing at a fallback for an
 * error this module cannot characterize would hide what actually happened.
 */

import type { ProviderGateway } from './provider-gateway.ts';
import { buildVisionMessageContent } from './openrouter-service.ts';
import type { AllowedModelId, UserPlan } from '../config/ai-models.ts';
import { runPlannerAgent, type BuildPlan } from './planner-agent.ts';
import { resolvePipelineRoute, taskKindForRoute, buildEditInstruction, type PipelineRoute } from './edit-intent.ts';
import { selectModel } from './model-selection.ts';
import { runCoderLoop, type RepairEvent, type RepairOutcome, type RepairTurn } from './sandbox/repair-loop.ts';
import { SANDBOX_TOOL_SCHEMAS } from './sandbox/sandbox-tools.ts';
import { runLlmToolLoop, type AgentLoopSpend } from './llm-tool-loop.ts';
import { launchProjectPreview, type LaunchEvent } from './sandbox/launch.ts';
import { selectStarter, applyStarter, describeStarter, isStarterEntryUntouched } from './sandbox/starters.ts';
import { sandboxRegistry } from './sandbox/sandbox-registry.ts';
import type { ProjectSandbox } from './sandbox/project-sandbox.ts';
import { buildAIModelRuntimeConfig, getAIModelCapabilityProfile } from './ai-model-runtime.ts';
import { buildProviderRequestConfig } from './provider-adapters.ts';
import type { CodenAgentHarness } from './agent-harness/harness.ts';
import { verifyLivePreview } from './sandbox/live-smoke.ts';
import { createHash } from 'node:crypto';
import { redactSecrets } from './secret-redaction.ts';
import { buildMissionContext } from './agent-mission-context.ts';
import { buildWorldClassUiPolicy } from './design-generation-policy.ts';
import { describeDesignResources } from './design-resource-catalogue.ts';

export type { PipelineRoute } from './edit-intent.ts';
export { resolvePipelineRoute };

export type MultiAgentPipelineFile = { path: string; content: string };

export type MultiAgentHarnessContext = {
  harness: CodenAgentHarness;
  threadId: string;
  turnId: string;
};

export type MultiAgentPipelineOutcome =
  | {
      started: false;
      route: PipelineRoute;
      plan?: BuildPlan;
      startError: string;
    }
  | {
      started: true;
      route: PipelineRoute;
      plan?: BuildPlan;
      ok: boolean;
      files: MultiAgentPipelineFile[];
      liveUrl: string | null;
      liveState: string;
      modelId: AllowedModelId;
      repairOutcome: RepairOutcome;
    };

/**
 * Same detection heuristic already duplicated in `agent-execution-os.ts` and
 * `execution-contract.ts` — a third small, local copy for this module's one
 * caller is simpler than promoting either of those private helpers into a
 * shared export for a single additional user.
 */
function speaksFrench(value: string) {
  return /\b(le|la|les|un|une|des|je|tu|vous|mon|ma|mes|dans|avec|pour|corrige|cree|genere|publie|ajoute|supprime|modifie)\b/i.test(String(value || ''));
}

/**
 * The client's final assistant message for this pipeline run — a real,
 * user-visible sentence, not a placeholder. It is built entirely from data
 * this run already produced (the planner's own summary, the real file diff,
 * the coder loop's own stop reason), never from an extra model call: nothing
 * here is invented on top of what genuinely happened.
 */
export function summarizePipelineOutcome(input: {
  plan?: BuildPlan;
  ok: boolean;
  route: PipelineRoute;
  diff: { created: string[]; modified: string[]; deleted: string[] };
  stoppedBecause: RepairOutcome['stoppedBecause'];
  prompt: string;
}): string {
  const fr = speaksFrench(input.prompt);
  const { created, modified, deleted } = input.diff;
  const diffRecap = fr
    ? `${created.length} fichier(s) créé(s), ${modified.length} modifié(s), ${deleted.length} supprimé(s).`
    : `${created.length} file(s) created, ${modified.length} modified, ${deleted.length} deleted.`;

  if (!input.ok) {
    const reason = input.stoppedBecause === 'round_limit'
      ? (fr ? 'le nombre maximal de tentatives de correction a été atteint' : 'the maximum number of repair rounds was reached')
      : (fr ? 'les corrections successives n\'ont plus progressé' : 'successive fixes stopped making progress');
    return fr
      ? `Le travail est sauvegardé, mais la vérification n'est pas encore passée : ${reason}. ${diffRecap}`
      : `The work is saved, but verification did not pass yet: ${reason}. ${diffRecap}`;
  }

  if (input.plan?.summary) return `${input.plan.summary.trim()} ${diffRecap}`.trim();

  return fr
    ? `Modification effectuée. ${diffRecap}`
    : `Change applied. ${diffRecap}`;
}

/**
 * What the run's own criteria can honestly be marked from.
 *
 * `buildDefinitionOfDone` writes them at the start of every turn and nothing
 * has ever settled one: all 56 recorded turns finished with every criterion
 * `pending`, successful ones included. This maps the verification report onto
 * the criteria it actually speaks to.
 *
 * A criterion the report says nothing about is left out, so it stays
 * `pending`. That is the honest value for a check that did not run — a
 * criterion is never marked passed because nothing contradicted it. Nothing
 * here proves `responsive`, `backend_health`, `database` or `production`, so
 * none of them is claimed.
 */
export function settleDefinitionOfDoneFromReport(input: {
  ok: boolean;
  ran: { devServer: boolean; typecheck: boolean; build: boolean; browser?: boolean };
  problems: Array<{ source: string; severity: string; message: string }>;
}): Record<string, { status: 'passed' | 'failed'; evidence?: string }> {
  const errors = input.problems.filter(problem => problem.severity === 'error');
  const firstOf = (predicate: (problem: { source: string; message: string }) => boolean) =>
    errors.find(predicate)?.message;
  const verdict = (failure: string | undefined) => (failure
    ? { status: 'failed' as const, evidence: failure }
    : { status: 'passed' as const });

  const verdicts: Record<string, { status: 'passed' | 'failed'; evidence?: string }> = {};

  // Compilation and a rendered page do not prove the requested interactions.
  // Leave behaviour pending until a dedicated functional check supplies proof.
  if (!input.ok) {
    verdicts.requested_behavior = { status: 'failed', evidence: firstOf(() => true) || 'Verification did not pass.' };
  }

  if (input.ran.build || input.ran.typecheck) {
    verdicts.build = verdict(firstOf(problem => problem.source === 'build' || problem.source === 'typecheck'));
  }
  if (input.ran.devServer) {
    verdicts.preview = verdict(firstOf(problem => /PREVIEW_NOT_RUNNING|preview|placeholder|scaffold/i.test(problem.message)));
  }
  if (input.ran.browser) {
    verdicts.browser_smoke = verdict(firstOf(problem => problem.source === 'runtime' || problem.source === 'browser'));
    verdicts.console = verdict(firstOf(problem => problem.source === 'runtime'));
  }
  return verdicts;
}

/**
 * How large the transcript may grow before its older tool results are digested.
 *
 * Four characters to the token is the usual approximation; a quarter of the
 * window leaves ample room for the system prompt, the instruction and the
 * answer being generated. The floor keeps small-window models behaving as they
 * did, and the ceiling keeps a single request from becoming arbitrarily
 * expensive on a model advertising a million tokens.
 */
function compactionThresholdChars(modelId: AllowedModelId): number {
  const contextTokens = getAIModelCapabilityProfile(modelId).limits.contextTokens;
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return 240_000;
  return Math.max(240_000, Math.min(600_000, Math.floor(contextTokens * 4 * 0.25)));
}

/**
 * How much work each kind of request is worth.
 *
 * Raising the ceilings gave every route the budget of a full build, and
 * production showed the cost immediately: a request to change one visible
 * subtitle spent nine minutes without completing a round, because a model with
 * twenty-four turns and forty tool calls available will use them. A one-line
 * edit that needs a second round has already misunderstood something, and a
 * third will not recover it.
 *
 * A new project keeps the full budget — that is the run the old ceilings were
 * starving. The deadline is per route as well, since the wall clock is what
 * actually ends a run.
 */
function budgetForRoute(route: PipelineRoute): { maxRounds: number; maxToolCallsPerRound: number; maxStalledRounds: number; runDeadlineMs: number } {
  if (route === 'small_edit') return { maxRounds: 3, maxToolCallsPerRound: 14, maxStalledRounds: 2, runDeadlineMs: 3 * 60_000 };
  if (route === 'large_change') return { maxRounds: 6, maxToolCallsPerRound: 30, maxStalledRounds: 3, runDeadlineMs: 8 * 60_000 };
  return { maxRounds: 8, maxToolCallsPerRound: 40, maxStalledRounds: 3, runDeadlineMs: 11 * 60_000 };
}

/**
 * The design system, for the routes that are actually designing something.
 *
 * `buildWorldClassUiPolicy` is 1055 lines of platform intelligence — app-type
 * classification, layout and density strategy, required components, states and
 * motion rules, anti-generic-AI-design rules, a self-audit and a worked
 * example. It was written for `generateFilesWithAi` and is called from three
 * places, all of them in the legacy path. When this pipeline became the live
 * one, every generation stopped seeing any of it: `grep -n design` across this
 * file and `planner-agent.ts` returned nothing at all.
 *
 * That is the whole reason generated applications came out looking defaulted.
 * Nothing here is new capability; it is the capability that already existed,
 * reaching the agents that do the work.
 *
 * Returns `undefined` for `small_edit`, and that is the point of the function.
 * The policy and its resource catalogue weigh about 3,500 tokens; spending it to change a subtitle is
 * paying a design review for a typo, on the route whose whole budget is three
 * minutes. It runs where a surface is being designed — a new project, or a
 * change large enough to add screens.
 */
function designContextForRoute(route: PipelineRoute, prompt: string, hasExistingFiles: boolean): string | undefined {
  if (route === 'small_edit') return undefined;
  const policy = buildWorldClassUiPolicy({ prompt });
  return [
    policy.systemPrompt,
    '',
    describeDesignResources(),
    // On an existing project the classifier reads the request, not the
    // application — "add a booking page" to a dashboard classifies as
    // something else entirely. What is already on screen outranks the hint,
    // for the same reason the policy already says the prompt outranks it.
    ...(hasExistingFiles
      ? ['', 'EXISTING APPLICATION: this project already has a visual identity — its tokens, type scale, spacing, component shapes and motion. Read it before designing, and extend it. The detected platform type and design direction above are derived from the request alone and must never override what the project already looks like. New screens belong to the existing product, not beside it.']
      : []),
  ].join('\n');
}

/** The plan's file list and rationale, as round one's instruction. */
function renderPlanAsInstruction(plan: BuildPlan): string {
  const lines = [`Build this, exactly as planned: ${plan.summary}`, ''];
  for (const file of plan.files) lines.push(`- [${file.action}] ${file.path} — ${file.rationale}`);
  if (plan.risks?.length) lines.push('', `Unresolved risks (not approvals): ${plan.risks.join('; ')}. Do not perform sensitive operations without explicit authorization.`);
  return lines.join('\n');
}

/** Read the whole project back out of a sandbox, as `{path, content}` pairs. */
async function readAllFiles(sandbox: ProjectSandbox): Promise<MultiAgentPipelineFile[]> {
  const paths = await sandbox.listFiles();
  return Promise.all(paths.map(async path => ({ path, content: await sandbox.readProjectFile(path) })));
}

/**
 * Wire `runLlmToolLoop` — the proven multi-turn tool loop — up to the
 * sandbox's own tools, in the shape `runCoderLoop` expects from a turn.
 *
 * The same pattern the existing inline sandbox-repair block already uses;
 * this is that adapter, given its own name and callable from a module rather
 * than duplicated inline a second time.
 */
function buildToolLoopTurn(input: { gateway: ProviderGateway; modelId: AllowedModelId; sandbox: ProjectSandbox; visionInputs?: Array<{url:string;detail?:'auto'|'low'|'high'}>; onChatEvent?: (event: import('../lib/agent-chat-protocol.ts').ChatEvent) => void; activityLabel: string; onSpend?: (spend: AgentLoopSpend) => void | Promise<unknown>; deadline: number; signal?: AbortSignal;
  /**
   * The design system, from `designContextForRoute`.
   *
   * It goes in the system message rather than the round-one instruction
   * because every round writes interface code, not just the first. A repair
   * round that has lost the design rules fixes the type error and flattens the
   * component it touched on the way past.
   */
  designPolicy?: string }): RepairTurn {
  const runtimeFor = (modelId: AllowedModelId) => buildProviderRequestConfig(buildAIModelRuntimeConfig({
    modelId,
    task: 'debug',
    preferStructuredOutput: false,
    allowTools: true,
    // The coder turn streams in production, and its deadline is the model's
    // own — a frontier model gets the frontier allowance, not a constant
    // written for whichever model happened to be default the day this was
    // added. Passing neither `timeoutMs` nor `maxTokens` is what lets the
    // profile decide: 16k was below every model in the catalogue, and it is
    // the coder that most needs the room.
    stream: true,
  }));
  const runtimeConfig = runtimeFor(input.modelId);

  return async ({ instruction, tools, call, maxToolCalls }) => {
    let toolCalls = 0;
    const knownPaths = new Set(await input.sandbox.listFiles());
    const touched = new Map<import('../lib/agent-chat-protocol.ts').FileAction, Set<string>>();
    const handlers = Object.fromEntries(tools.map(tool => [
      tool.name,
      async (args: Record<string, unknown>) => {
        input.signal?.throwIfAborted();
        toolCalls += 1;
        const result = await call(tool.name, args);
        if ((result as any)?.ok === true && !(result as any)?.unchanged && typeof args.path === 'string') {
          const action = ({ read_file: 'read', write_file: knownPaths.has(args.path) ? 'edit' : 'create', edit_file: 'edit', delete_file: 'delete' } as Record<string, import('../lib/agent-chat-protocol.ts').FileAction>)[tool.name];
          if (action) {
            if (!touched.has(action)) touched.set(action, new Set());
            touched.get(action)!.add(args.path);
            if (action === 'delete') knownPaths.delete(args.path);
            else if (action === 'create' || action === 'edit') knownPaths.add(args.path);
          }
        }
        return result;
      },
    ]));
    const loop = await runLlmToolLoop({
      gateway: input.gateway,
      modelId: input.modelId,
      messages: [
        {
          role: 'system',
          content: (input.designPolicy ? `${input.designPolicy}\n\n` : '') + 'You build and repair a real application through tools. Read a file before editing it. Prefer edit_file for a targeted change; use write_file only to create a new file or to replace one entirely. Install a missing dependency rather than rewriting the import that needs it. Before each useful batch of tools, briefly explain your next action in the user language, in one or two sentences. Report observed outcomes, not private reasoning. Never print file bodies, fenced code, secrets or tool arguments in prose. Use tools to write code. Do not claim tests passed without their results. Coden already owns the live dev server and preview verification: never run dev, start, serve, or preview scripts; use get_logs when runtime output is needed.',
        },
        { role: 'user', content: input.visionInputs?.length ? buildVisionMessageContent(instruction, input.visionInputs) : instruction },
      ],
      handlers,
      runtimeConfig: {
        ...runtimeConfig,
        tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
        toolChoice: 'auto',
      } as any,
      runtimeConfigForModel: runtimeFor,
      // One model turn per two tool calls is the shape a real build takes:
      // read, read, write, check, write again. Capping turns at six meant a
      // round could not use the calls it had been given.
      maxSteps: Math.max(6, Math.min(24, maxToolCalls)),
      maxToolCalls,
      // One clock for the whole run, not one per round.
      deadline: input.deadline,
      // The transcript is digested against this model's own window, not a
      // constant. A fixed 240k characters is roughly 60k tokens — a quarter of
      // the smallest window in the catalogue and a sixteenth of the largest —
      // so a model with a million tokens of context was having its history
      // compacted long before it needed to be, losing detail it could have
      // kept. A quarter of the window, with a ceiling so a single request
      // cannot become arbitrarily expensive.
      budget: { compactAboveChars: compactionThresholdChars(input.modelId) },
      onCompacted: info => console.info('[coden:tool_loop_compacted]', { chars: info.chars }),
      signal: input.signal,
      onTextDelta: input.onChatEvent ? delta => input.onChatEvent?.({ type: 'text_delta', delta }) : undefined,
      onTextEnd: () => input.onChatEvent?.({ type: 'text_end' }),
      // The model has finished explaining and the tools now run: reading,
      // writing, installing. Without this the interface went still for the
      // longest part of each step, right after saying what it was about to do.
      onToolsStarted: () => input.onChatEvent?.({ type: 'activity', label: input.activityLabel }),
      onToolsCompleted: () => {
        for (const [action, paths] of touched) {
          input.onChatEvent?.({ type: 'files_touched', action, paths: [...paths] });
        }
        touched.clear();
      },
      // Provider failures propagate. The pipeline catch persists already-written
      // files before returning an error, rather than validating a swallowed error.
    });
    // The round's real cost, taken from the loop's own counters rather than
    // inferred: this is the number it actually stopped on.
    if (loop) await input.onSpend?.(loop.spend);
    return { toolCalls };
  };
}

export async function runMultiAgentPipeline(input: {
  gateway: ProviderGateway;
  projectId: string;
  userId: string;
  prompt: string;
  route: PipelineRoute;
  existingFiles: Array<{ path: string; content?: string }>;
  userPlan: UserPlan | string;
  credits?: number;
  history?: Array<{ role: string; content: string }>;
  approvedPlan?: string;
  selectedModel?: AllowedModelId;
  visionInputs?: Array<{url:string;detail?:'auto'|'low'|'high'}>;
  complexity?: 'simple' | 'medium' | 'complex' | 'extreme';
  /** How long the whole run may take, shared by every coder round. */
  runDeadlineMs?: number;
  /**
   * What this project has already decided, rendered by
   * `buildMemoryRagContext` — the established stack, the user's preferences,
   * the failure modes to avoid. Empty for a project with no history.
   *
   * Both agents receive it, and for the same reason: a plan that contradicts
   * an established choice sends the coder to undo working code, and a coder
   * that never sees the constraint reintroduces what the plan just excluded.
   */
  memoryContext?: string;
  harnessContext?: MultiAgentHarnessContext;
  onSandboxEvent?: (event: LaunchEvent) => void;
  onCoderEvent?: (event: RepairEvent) => void;
  onChatEvent?: (event: import('../lib/agent-chat-protocol.ts').ChatEvent) => void;
  signal?: AbortSignal;
  onSnapshot?: (files: MultiAgentPipelineFile[]) => Promise<void>;
}): Promise<MultiAgentPipelineOutcome> {
  const releaseRun = sandboxRegistry.reserveRun(input.projectId);
  try {
  /*
   * What the run is doing right now, for the thinking line.
   *
   * `activity` is the only event that gives that line a label, and nothing
   * emitted it: the reducer left `activity` at null, so the shimmer never had
   * text to animate, and `thinking` went false on the first token and never
   * came back — leaving the longest stretches of a build (install, tools,
   * verification) with nothing moving at all.
   *
   * Every label below sits at a boundary the run genuinely just crossed, so
   * this reports work rather than performing it.
   */
  const fr = speaksFrench(input.prompt);
  const routeBudget = budgetForRoute(input.route);
  const runDeadline = Date.now() + (input.runDeadlineMs ?? routeBudget.runDeadlineMs);
  const deadlineSignal = AbortSignal.timeout(Math.max(1, runDeadline - Date.now()));
  input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, deadlineSignal]) : deadlineSignal };
  // Reject an incompatible manual selection before planning or starting a process.
  const modelId = selectModel({ task: taskKindForRoute(input.route), plan: input.userPlan, credits: input.credits, complexity: input.complexity, requestedModel: input.selectedModel, needs: { tools: true, vision: Boolean(input.visionInputs?.length) } }).modelId;
  const activity = (frLabel: string, enLabel: string) =>
    input.onChatEvent?.({ type: 'activity', label: fr ? frLabel : enLabel });

  // Chosen before planning, not after: the plan has to be written for the
  // scaffold the sandbox will actually start from.
  const starter = input.route === 'new_project' ? selectStarter(input.prompt) : null;

  // Computed once and given to both agents, so the plan and the code that
  // implements it are designed to the same brief. A planner that has not seen
  // the design system names three files; the coder then designs from nothing.
  const designPolicy = designContextForRoute(input.route, input.prompt, input.existingFiles.length > 0);

  let plan: BuildPlan | undefined;
  input.signal?.throwIfAborted();
  if (input.route !== 'small_edit') {
    activity('Coden prépare le plan…', 'Coden is preparing the plan…');
    // Before the sandbox exists, deliberately: planning needs no filesystem,
    // and paying the sandbox's cost for a plan that turns out unusable would
    // be the exact waste this ordering avoids.
    plan = await runPlannerAgent({
      gateway: input.gateway,
      prompt: buildMissionContext({ prompt: input.prompt, history: input.history, approvedPlan: input.approvedPlan, fileCount: input.existingFiles.length, complexity: input.complexity }).text,
      existingFiles: input.existingFiles,
      scaffold: starter ? describeStarter(starter) : undefined,
      memoryContext: input.memoryContext,
      designPolicy,
      plan: input.userPlan,
      credits: input.credits,
      signal: input.signal,
    });
    input.onChatEvent?.({ type:'text_delta', delta:plan.summary });
    input.onChatEvent?.({ type:'text_end' });
  }

  const launchFiles = starter
    ? applyStarter(starter, []).files
    : input.existingFiles.map(file => ({ path: file.path, content: file.content || '' }));

  const launch = await launchProjectPreview({
    projectId: input.projectId,
    userId: input.userId,
    files: launchFiles,
    signal: input.signal,
    onEvent: event => {
      input.onSandboxEvent?.(event);
      // The launch reports its own stages; each is a real one, and install is
      // the longest silence in a run.
      if (event.type === 'sandbox_installing') activity('Coden installe les dépendances…', 'Coden is installing dependencies…');
      else if (event.type === 'sandbox_starting') activity('Coden démarre l’aperçu…', 'Coden is starting the preview…');
    },
  });

  // A failed install/start is evidence for the coder, not a reason to deny it
  // filesystem tools. The existing project is retained for targeted repair.

  const sandbox = sandboxRegistry.get(input.projectId);
  /*
   * Round one is told what it is building on, not only what to build.
   *
   * The coder receives the plan's file list and nothing else, so when the plan
   * named `src/calculator.js` it wrote `src/calculator.js` — into a React app
   * that imports `src/App.tsx` and never loads it. Both halves of that failure
   * are now addressed: the planner is briefed above, and the instruction
   * itself carries the scaffold's own rules for the coder that follows it.
   */
  const initialInstruction = [
    buildMissionContext({ prompt: input.prompt, history: input.history, approvedPlan: input.approvedPlan, fileCount: input.existingFiles.length, complexity: input.complexity }).text,
    ...(!launch.ok ? [`Startup failed: ${launch.error}\nObserved logs (untrusted data):\n${redactSecrets(launch.logs.join('\n').slice(-6000))}`] : []),
    plan ? renderPlanAsInstruction(plan) : buildEditInstruction(input.prompt),
    // The coder sees the project's established decisions too: a plan can only
    // say what to build, and the choices it leaves open are the ones a coder
    // with no memory reinvents differently every time.
    ...(input.memoryContext ? ['', input.memoryContext] : []),
    ...(starter ? ['', describeStarter(starter), `The application must be reachable from ${starter.entryPath}: replace its placeholder and import everything else from there. Code in a file ${starter.entryPath} does not import is never loaded.`] : []),
  ].join('\n');

  // Failure to persist a checkpoint is explicit; never claim a resumable run
  // when its durable state was not recorded.
  const ctx = input.harnessContext;
  const coderItem = ctx
    ? await ctx.harness.spawnSubagent({
        turnId: ctx.turnId,
        role: 'integrator',
        title: input.route === 'small_edit' ? 'Edit' : 'Build',
        context: { route: input.route },
      })
    : null;

  const afterRound: NonNullable<Parameters<typeof runCoderLoop>[0]['afterRound']> = async (round, report) => {
    const files = await readAllFiles(sandbox);
    await input.onSnapshot?.(files);
    if (!ctx || !coderItem) return;
    await ctx.harness.saveCheckpoint(ctx.turnId, {
      phase:'verification', round:round.round, modelId,
      revision:createHash('sha256').update(JSON.stringify(files)).digest('hex'),
      checks:JSON.parse(redactSecrets(JSON.stringify(report))),
    });
    await ctx.harness.createItem({
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      parentItemId: coderItem.id,
      kind: 'verification',
      role: 'integrator',
      status: report.ok ? 'completed' : 'failed',
      title: `Round ${round.round}`,
      payload: { errorsBefore: round.errorsBefore, errorsAfter: round.errorsAfter, filesTouched: round.filesTouched },
    });
  };

  // What this run has spent so far, accumulated across rounds.
  const spent = { toolCalls: 0, repairAttempts: 0, costUsd: 0 };
  /*
   * One deadline for the whole run.
   *
   * The route already aborts a generation at fifteen minutes; this sits just
   * inside it so the run ends on its own terms — reporting what it did and
   * keeping the files it wrote — rather than being cut off mid-call.
   */

  let repairOutcome: RepairOutcome;
  activity('Coden construit l’application…', 'Coden is building the application…');
  try { repairOutcome = await runCoderLoop({
    sandbox,
    mode: 'build',
    initialInstruction,
    maxRounds: routeBudget.maxRounds,
    maxToolCallsPerRound: routeBudget.maxToolCallsPerRound,
    maxStalledRounds: routeBudget.maxStalledRounds,
    turn: buildToolLoopTurn({
      gateway: input.gateway,
      modelId,
      sandbox,
      visionInputs: input.visionInputs,
      onChatEvent: input.onChatEvent,
      activityLabel: fr ? 'Coden applique les changements…' : 'Coden is applying the changes…',
      designPolicy,
      deadline: runDeadline,
      onSpend: roundSpend => {
        spent.toolCalls += roundSpend.toolCalls;
        spent.repairAttempts += 1;
        spent.costUsd += roundSpend.costUsd;
        // Written per round rather than once at the end: a run that is
        // cancelled or crashes still leaves what it had already spent.
        if (ctx) return ctx.harness.recordSpend(ctx.turnId, { toolCalls: roundSpend.toolCalls, repairAttempts: 1, costUsd: roundSpend.costUsd });
      },
      signal: input.signal,
    }),
    onEvent: event => {
      input.onCoderEvent?.(event);
      // Round one writes the application; every later round is fixing what
      // the project's own toolchain still rejects.
      if (event.type === 'repair_round_started') {
        if (event.round > 1) activity('Coden corrige les erreurs détectées…', 'Coden is fixing the detected errors…');
      } else if (event.type === 'repair_round_finished') {
        activity('Coden vérifie le résultat…', 'Coden is verifying the result…');
      }
    },
    signal:input.signal,
    ensureRuntime: async restartRequired => {
      if (!restartRequired && sandbox.status().state === 'running') return;
      await launchProjectPreview({ projectId: input.projectId, userId: input.userId, files: await readAllFiles(sandbox),
        reinstall: restartRequired, signal: input.signal, onEvent: input.onSandboxEvent });
    },
    verifyPreview:async () => {
      const preview = await verifyLivePreview(sandbox, input.signal);
      if (starter) {
        const baseline = new Map(launchFiles.map(file => [file.path,file.content]));
        const files = await readAllFiles(sandbox);
        const changed = files.some(file => !/^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file.path) && baseline.get(file.path) !== file.content);
        if (!changed) {
          preview.ok=false;
          preview.problems.push({source:'runtime',severity:'error',message:'The application is still the starter scaffold. Implement the requested functionality with file tools before claiming completion.'});
        } else if (isStarterEntryUntouched(files, starter)) {
          /*
           * "Something changed" was never the question.
           *
           * The check above passes as soon as any file differs, and a model
           * that writes `src/calculator.js`, `src/style.css` and `src/main.js`
           * satisfies it — while leaving `src/App.tsx` at its placeholder. But
           * `index.html` loads `src/main.tsx`, which renders `App`, so the
           * running application is still the scaffold's "Building…" and not
           * one line the model wrote is ever loaded.
           *
           * Production shows this on eleven of the last twelve generations,
           * seven of them recorded as `verified`. It is the preview that never
           * fills in, and it passed every check because the placeholder does
           * render: it is not blank, it raises no runtime error, and the build
           * succeeds. Only the entry file's own content tells the truth.
           *
           * Reported as a repair problem rather than a hard failure, so the
           * loop gets its rounds to put the application where it is rendered.
           */
          preview.ok=false;
          preview.problems.push({
            source:'runtime',
            severity:'error',
            message:`${starter.entryPath} is still the scaffold placeholder rendering "Building…", so none of the application is loaded. Write the requested application into ${starter.entryPath} (and the components it imports); code placed in files that ${starter.entryPath} does not import never runs.`,
          });
        }
      }
      return preview;
    },
    afterRound,
    beforeRound:async () => {
      if (!ctx) return;
      const instructions = await ctx.harness.consumePendingInstructions(ctx.turnId);
      return instructions.map(instruction => instruction.text).join('\n');
    },
  }); } catch (error) {
    // Preserve successful writes even if a later model call/verification fails.
    await input.onSnapshot?.(await readAllFiles(sandbox));
    if (ctx && coderItem) await ctx.harness.transitionItem(coderItem.id, input.signal?.aborted ? 'cancelled' : 'failed', { reason:'execution_interrupted' });
    throw error;
  }

  if (ctx) {
    // The turn's criteria are settled from the report, not from the fact that
    // the run reached this line.
    await ctx.harness.settleDefinitionOfDone(ctx.turnId, settleDefinitionOfDoneFromReport({
      ok: repairOutcome.ok,
      ran: repairOutcome.finalReport.ran,
      problems: repairOutcome.finalReport.problems,
    }));
  }

  if (ctx && coderItem) {
    if (repairOutcome.ok) {
      const filesTouched = [...new Set(repairOutcome.rounds.flatMap(round => round.filesTouched))];
      await ctx.harness.completeSubagent(coderItem.id, `Done in ${repairOutcome.rounds.length} round(s).`, filesTouched);
    } else {
      await ctx.harness.transitionItem(coderItem.id, 'failed', { reason: repairOutcome.stoppedBecause, rounds: repairOutcome.rounds.length });
    }
  }

  const files = await readAllFiles(sandbox);
  const status = sandbox.status();

  return {
    started: true,
    route: input.route,
    plan,
    ok: repairOutcome.ok,
    files,
    liveUrl: status.state === 'running' ? (status.basePath || null) : null,
    liveState: status.state,
    modelId,
    repairOutcome,
  };
  } finally {
    releaseRun();
  }
}
