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
import type { AllowedModelId, UserPlan } from '../config/ai-models.ts';
import { runPlannerAgent, type BuildPlan } from './planner-agent.ts';
import { resolvePipelineRoute, taskKindForRoute, buildEditInstruction, type PipelineRoute } from './edit-intent.ts';
import { selectModel } from './model-selection.ts';
import { runCoderLoop, type RepairEvent, type RepairOutcome, type RepairTurn } from './sandbox/repair-loop.ts';
import { SANDBOX_TOOL_SCHEMAS } from './sandbox/sandbox-tools.ts';
import { runLlmToolLoop } from './llm-tool-loop.ts';
import { launchProjectPreview, type LaunchEvent } from './sandbox/launch.ts';
import { selectStarter, applyStarter } from './sandbox/starters.ts';
import { sandboxRegistry } from './sandbox/sandbox-registry.ts';
import type { ProjectSandbox } from './sandbox/project-sandbox.ts';
import { buildAIModelRuntimeConfig } from './ai-model-runtime.ts';
import { buildProviderRequestConfig } from './provider-adapters.ts';
import type { CodenAgentHarness } from './agent-harness/harness.ts';
import { verifyLivePreview } from './sandbox/live-smoke.ts';
import { createHash } from 'node:crypto';
import { redactSecrets } from './secret-redaction.ts';

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
function buildToolLoopTurn(input: { gateway: ProviderGateway; modelId: AllowedModelId; sandbox: ProjectSandbox; onChatEvent?: (event: import('../lib/agent-chat-protocol.ts').ChatEvent) => void; activityLabel: string; signal?: AbortSignal }): RepairTurn {
  const runtimeFor = (modelId: AllowedModelId) => buildProviderRequestConfig(buildAIModelRuntimeConfig({
    modelId,
    task: 'debug',
    preferStructuredOutput: false,
    allowTools: true,
    // The coder turn streams in production, and its deadline is the model's
    // own — a frontier model gets the frontier allowance, not a constant
    // written for whichever model happened to be default the day this was
    // added. Passing no `timeoutMs` is what lets the profile decide.
    stream: true,
    maxTokens: 16_000,
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
        if ((result as any)?.ok === true && typeof args.path === 'string') {
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
    await runLlmToolLoop({
      gateway: input.gateway,
      modelId: input.modelId,
      messages: [
        {
          role: 'system',
          content: 'You build and repair a real application through tools. Read a file before editing it. Prefer edit_file for a targeted change; use write_file only to create a new file or to replace one entirely. Install a missing dependency rather than rewriting the import that needs it. Before each useful batch of tools, briefly explain your next action in the user language, in one or two sentences. Report observed outcomes, not private reasoning. Never print file bodies, fenced code, secrets or tool arguments in prose. Use tools to write code. Do not claim tests passed without their results.',
        },
        { role: 'user', content: instruction },
      ],
      handlers,
      runtimeConfig: {
        ...runtimeConfig,
        tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
        toolChoice: 'auto',
      } as any,
      runtimeConfigForModel: runtimeFor,
      maxSteps: Math.min(6, maxToolCalls),
      maxToolCalls,
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
      // A turn that throws produced nothing this round; `runCoderLoop`'s own
      // no-progress rule is what decides whether that is worth continuing
      // from, not this adapter guessing at a retry.
      //
      // The catch is the half that makes that true. Without it a throw from
      // one round — a provider dropping mid-call, a tool budget spent — left
      // the coder loop, the pipeline and the route, and the user got a bare
      // error code instead of the files the round had already written. A
      // cancelled run is the one exception: it must keep propagating, because
      // the caller asked for it.
    }).catch((error: any) => {
      if (input.signal?.aborted) throw error;
    });
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
  harnessContext?: MultiAgentHarnessContext;
  onSandboxEvent?: (event: LaunchEvent) => void;
  onCoderEvent?: (event: RepairEvent) => void;
  onChatEvent?: (event: import('../lib/agent-chat-protocol.ts').ChatEvent) => void;
  signal?: AbortSignal;
  onSnapshot?: (files: MultiAgentPipelineFile[]) => Promise<void>;
}): Promise<MultiAgentPipelineOutcome> {
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
  const activity = (frLabel: string, enLabel: string) =>
    input.onChatEvent?.({ type: 'activity', label: fr ? frLabel : enLabel });

  let plan: BuildPlan | undefined;
  input.signal?.throwIfAborted();
  if (input.route !== 'small_edit') {
    activity('Coden prépare le plan…', 'Coden is preparing the plan…');
    // Before the sandbox exists, deliberately: planning needs no filesystem,
    // and paying the sandbox's cost for a plan that turns out unusable would
    // be the exact waste this ordering avoids.
    plan = await runPlannerAgent({
      gateway: input.gateway,
      prompt: input.prompt,
      existingFiles: input.existingFiles,
      plan: input.userPlan,
      credits: input.credits,
      signal: input.signal,
    });
    input.onChatEvent?.({ type:'text_delta', delta:plan.summary });
    input.onChatEvent?.({ type:'text_end' });
  }

  const launchFiles = input.route === 'new_project'
    ? applyStarter(selectStarter(input.prompt), []).files
    : input.existingFiles.map(file => ({ path: file.path, content: file.content || '' }));

  const launch = await launchProjectPreview({
    projectId: input.projectId,
    userId: input.userId,
    files: launchFiles,
    onEvent: event => {
      input.onSandboxEvent?.(event);
      // The launch reports its own stages; each is a real one, and install is
      // the longest silence in a run.
      if (event.type === 'sandbox_installing') activity('Coden installe les dépendances…', 'Coden is installing dependencies…');
      else if (event.type === 'sandbox_starting') activity('Coden démarre l’aperçu…', 'Coden is starting the preview…');
    },
  });

  if (!launch.ok) {
    return { started: false, route: input.route, plan, startError: launch.error || 'The sandbox did not start.' };
  }

  const sandbox = sandboxRegistry.get(input.projectId);
  const modelId = selectModel({ task: taskKindForRoute(input.route), plan: input.userPlan, credits: input.credits }).modelId;
  const initialInstruction = plan ? renderPlanAsInstruction(plan) : buildEditInstruction(input.prompt);

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

  let repairOutcome: RepairOutcome;
  try { repairOutcome = await runCoderLoop({
    sandbox,
    mode: 'build',
    initialInstruction,
    turn: buildToolLoopTurn({
      gateway: input.gateway,
      modelId,
      sandbox,
      onChatEvent: input.onChatEvent,
      activityLabel: fr ? 'Coden applique les changements…' : 'Coden is applying the changes…',
      signal: input.signal,
    }),
    onEvent: event => {
      input.onCoderEvent?.(event);
      // Round one writes the application; every later round is fixing what
      // the project's own toolchain still rejects.
      if (event.type === 'repair_round_started') {
        if (event.round === 1) activity('Coden construit l’application…', 'Coden is building the application…');
        else activity('Coden corrige les erreurs détectées…', 'Coden is fixing the detected errors…');
      } else if (event.type === 'repair_round_finished') {
        activity('Coden vérifie le résultat…', 'Coden is verifying the result…');
      }
    },
    signal:input.signal,
    verifyPreview:async () => {
      const preview = await verifyLivePreview(sandbox, input.signal);
      if (input.route === 'new_project') {
        const baseline = new Map(launchFiles.map(file => [file.path,file.content]));
        const files = await readAllFiles(sandbox);
        const changed = files.some(file => !/^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file.path) && baseline.get(file.path) !== file.content);
        if (!changed) {
          preview.ok=false;
          preview.problems.push({source:'runtime',severity:'error',message:'The application is still the starter scaffold. Implement the requested functionality with file tools before claiming completion.'});
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
}
