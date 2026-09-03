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
import { createNarrationFilter } from './narration-filter.ts';
import { launchProjectPreview, type LaunchEvent } from './sandbox/launch.ts';
import { selectStarter, applyStarter } from './sandbox/starters.ts';
import { sandboxRegistry } from './sandbox/sandbox-registry.ts';
import type { ProjectSandbox } from './sandbox/project-sandbox.ts';
import { buildAIModelRuntimeConfig } from './ai-model-runtime.ts';
import { buildProviderRequestConfig } from './provider-adapters.ts';
import type { CodenAgentHarness } from './agent-harness/harness.ts';

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
  if (plan.risks?.length) lines.push('', `Known risks, already accepted: ${plan.risks.join('; ')}`);
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
function buildToolLoopTurn(input: { gateway: ProviderGateway; modelId: AllowedModelId; sandbox: ProjectSandbox; onToken?: (text: string) => void }): RepairTurn {
  const runtimeFor = (modelId: AllowedModelId) => buildProviderRequestConfig(buildAIModelRuntimeConfig({
    modelId,
    task: 'debug',
    allowTools: true,
    stream: false,
    timeoutMs: 60_000,
    maxTokens: 6_000,
  }));
  const runtimeConfig = runtimeFor(input.modelId);

  return async ({ instruction, tools, call, maxToolCalls }) => {
    let toolCalls = 0;
    const handlers = Object.fromEntries(tools.map(tool => [
      tool.name,
      async (args: Record<string, unknown>) => { toolCalls += 1; return call(tool.name, args); },
    ]));
    // Per round, because a fence never spans two model calls. What the round
    // says travels to the conversation; what it writes travels as files.
    const narration = createNarrationFilter();
    const onToken = input.onToken
      ? (text: string) => {
          const visible = narration(text);
          if (visible) input.onToken!(visible);
        }
      : undefined;
    await runLlmToolLoop({
      gateway: input.gateway,
      modelId: input.modelId,
      messages: [
        {
          role: 'system',
          content: 'You build and repair a real application through tools. Read a file before editing it. Prefer edit_file for a targeted change; use write_file only to create a new file or to replace one entirely. Install a missing dependency rather than rewriting the import that needs it.',
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
      timeoutMs: 60_000,
      maxSteps: Math.min(6, maxToolCalls),
      onToken,
      // A turn that throws produced nothing this round; `runCoderLoop`'s own
      // no-progress rule is what decides whether that is worth continuing
      // from, not this adapter guessing at a retry.
    }).catch(() => {});
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
}): Promise<MultiAgentPipelineOutcome> {
  let plan: BuildPlan | undefined;
  if (input.route !== 'small_edit') {
    // Before the sandbox exists, deliberately: planning needs no filesystem,
    // and paying the sandbox's cost for a plan that turns out unusable would
    // be the exact waste this ordering avoids.
    plan = await runPlannerAgent({
      gateway: input.gateway,
      prompt: input.prompt,
      existingFiles: input.existingFiles,
      plan: input.userPlan,
      credits: input.credits,
    });
  }

  const launchFiles = input.route === 'new_project'
    ? applyStarter(selectStarter(input.prompt), []).files
    : input.existingFiles.map(file => ({ path: file.path, content: file.content || '' }));

  const launch = await launchProjectPreview({
    projectId: input.projectId,
    userId: input.userId,
    files: launchFiles,
    onEvent: input.onSandboxEvent,
  });

  if (!launch.ok) {
    return { started: false, route: input.route, plan, startError: launch.error || 'The sandbox did not start.' };
  }

  const sandbox = sandboxRegistry.get(input.projectId);
  const modelId = selectModel({ task: taskKindForRoute(input.route), plan: input.userPlan, credits: input.credits }).modelId;
  const initialInstruction = plan ? renderPlanAsInstruction(plan) : buildEditInstruction(input.prompt);

  // A harness write can fail on its own terms and must never be the reason a
  // real build does not happen — recording is degraded, not the build.
  const ctx = input.harnessContext;
  const coderItem = ctx
    ? await ctx.harness.spawnSubagent({
        turnId: ctx.turnId,
        role: 'integrator',
        title: input.route === 'small_edit' ? 'Edit' : 'Build',
        context: { route: input.route },
      }).catch(() => null)
    : null;

  const onEvent = (event: RepairEvent) => {
    input.onCoderEvent?.(event);
    if (!ctx || !coderItem || event.type !== 'repair_round_finished') return;
    ctx.harness.createItem({
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      parentItemId: coderItem.id,
      kind: 'verification',
      role: 'integrator',
      status: event.errorsAfter === 0 ? 'completed' : 'failed',
      title: `Round ${event.round}`,
      payload: { errorsBefore: event.errorsBefore, errorsAfter: event.errorsAfter, filesTouched: event.filesTouched },
    }).catch(() => {});
  };

  const repairOutcome = await runCoderLoop({
    sandbox,
    mode: 'build',
    initialInstruction,
    turn: buildToolLoopTurn({ gateway: input.gateway, modelId, sandbox, onToken: text => onEvent({ type: 'token', text }) }),
    onEvent,
  });

  if (ctx && coderItem) {
    if (repairOutcome.ok) {
      const filesTouched = [...new Set(repairOutcome.rounds.flatMap(round => round.filesTouched))];
      await ctx.harness.completeSubagent(coderItem.id, `Done in ${repairOutcome.rounds.length} round(s).`, filesTouched).catch(() => {});
    } else {
      await ctx.harness.transitionItem(coderItem.id, 'failed', { reason: repairOutcome.stoppedBecause, rounds: repairOutcome.rounds.length }).catch(() => {});
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
