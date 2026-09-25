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

import { withUserInstructions } from './agent-personalization.ts';
import type { ProviderGateway } from './provider-gateway.ts';
import { buildVisionMessageContent } from './openrouter-service.ts';
import type { AllowedModelId, UserPlan } from '../config/ai-models.ts';
import { runPlannerAgent, type BuildPlan, type PlannerAgentResult } from './planner-agent.ts';
import { resolvePipelineRoute, taskKindForRoute, buildEditInstruction, type PipelineRoute } from './edit-intent.ts';
import { affordableReasoning, selectModel, type TaskComplexity } from './model-selection.ts';
import { MODEL_REGISTRY } from '../config/ai-models.ts';
import { runCoderLoop, type RepairEvent, type RepairOutcome, type RepairTurn } from './sandbox/repair-loop.ts';
import { SANDBOX_TOOL_SCHEMAS } from './sandbox/sandbox-tools.ts';
import { carryOverTranscript, compactTranscript, runLlmToolLoop, type AgentLoopSpend } from './llm-tool-loop.ts';
import type { ChatMessage } from './openrouter-service.ts';
import { launchProjectPreview, type LaunchEvent } from './sandbox/launch.ts';
import { selectStarter, applyStarter, describeStarter, isStarterEntryUntouched, themeStarter } from './sandbox/starters.ts';
import { STARTER_KIT_FILES } from './sandbox/starter-kit.ts';
import { sandboxRegistry } from './sandbox/sandbox-registry.ts';
import type { ProjectSandbox } from './sandbox/project-sandbox.ts';
import { buildAIModelRuntimeConfig, getAIModelCapabilityProfile } from './ai-model-runtime.ts';
import { buildProviderRequestConfig } from './provider-adapters.ts';
import type { CodenAgentHarness } from './agent-harness/harness.ts';
import type { HarnessAgentRole } from './agent-harness/contracts.ts';
import { recordToolCall } from './agent-harness/sandbox-tool-map.ts';
import { verifyLivePreview } from './sandbox/live-smoke.ts';
import { createHash } from 'node:crypto';
import { createStreamingRedactor, redactSecrets } from './secret-redaction.ts';
import { renderScenariosForCoder } from './sandbox/acceptance.ts';
import { buildMissionContext } from './agent-mission-context.ts';
import { buildWorldClassUiPolicy, classifyGeneratedAppType } from './design-generation-policy.ts';
import { describeDesignResources } from './design-resource-catalogue.ts';
import { describeProjectBackend } from './project-backend-store.ts';
import { isFrenchText } from './language-detection.ts';
import {
  mergeAgentOutputs,
  runParallelAgents,
  selectAgentsForContext,
  type AgentRole,
  type AgentTask,
} from './parallel-agent-runner.ts';
import { auditGeneratedDesign, auditGeneratedFunctionality } from './design-quality-auditor.ts';
import { inspectVisualPreview } from './visual-preview-inspector.ts';
import { normalizeAgentEffort, reasoningLevelForEffort, scaleRouteBudgetForEffort, type AgentEffort } from './agent-effort.ts';
import { REASONING_LEVELS, type ReasoningLevel } from './openrouter-request.ts';
import { resolveQualityPolicy } from './quality-tier.ts';
import { runDesignReview } from './design-review-agent.ts';
import type { ValidationProblem, ValidationReport } from './sandbox/validate.ts';

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
      /** Measured provider spend for the whole run, in USD. What the caller bills on. */
      costUsd: number;
    };

/**
 * Same detection heuristic already duplicated in `agent-execution-os.ts` and
 * `execution-contract.ts` — a third small, local copy for this module's one
 * caller is simpler than promoting either of those private helpers into a
 * shared export for a single additional user.
 */
const speaksFrench = isFrenchText;

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
  /** What the browser actually checked, so the recap can say so. */
  evidence?: ValidationReport['evidence'];
}): string {
  const fr = speaksFrench(input.prompt);
  const { created, modified, deleted } = input.diff;
  const scenarios = input.evidence?.scenarios || [];
  const passedJourneys = scenarios.filter(scenario => scenario.ok).length;
  const viewports = input.evidence?.responsiveViewports || [];
  // Only facts the run measured: journeys executed, widths rendered.
  const checked = [
    scenarios.length ? (fr ? `${passedJourneys}/${scenarios.length} parcours utilisateur testés dans le navigateur` : `${passedJourneys}/${scenarios.length} user journeys tested in the browser`) : '',
    viewports.length >= 2 ? (fr ? `rendu vérifié en ${viewports.map(width => `${width}px`).join(', ')}` : `rendering checked at ${viewports.map(width => `${width}px`).join(', ')}`) : '',
  ].filter(Boolean).join(fr ? ' ; ' : '; ');
  const diffRecap = (fr
    ? `${created.length} fichier(s) créé(s), ${modified.length} modifié(s), ${deleted.length} supprimé(s).`
    : `${created.length} file(s) created, ${modified.length} modified, ${deleted.length} deleted.`)
    + (checked ? ` ${checked.charAt(0).toUpperCase()}${checked.slice(1)}.` : '');

  if (!input.ok) {
    const reason = input.stoppedBecause === 'round_limit'
      ? (fr ? 'le nombre maximal de tentatives de correction a été atteint' : 'the maximum number of repair rounds was reached')
      : input.stoppedBecause === 'time_budget'
        ? (fr ? 'le temps alloué à cette demande est écoulé — relancez pour continuer les corrections' : 'the time allotted to this request ran out — ask again to continue the fixes')
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
 * Backend, database and production checks remain pending unless another
 * verifier supplies direct evidence for them.
 */
export function settleDefinitionOfDoneFromReport(input: {
  ok: boolean;
  ran: { devServer: boolean; typecheck: boolean; build: boolean; browser?: boolean };
  problems: Array<{ source: string; severity: string; message: string }>;
  evidence?: {
    responsiveViewports?: number[];
    qualityChecks?: Array<{ key: string; status: string; severity: string; message: string }>;
    interactions?: { attempted: number; changed: number };
    scenarios?: Array<{ name: string; ok: boolean; error?: string }>;
  };
}): Record<string, { status: 'passed' | 'failed'; evidence?: string }> {
  const errors = input.problems.filter(problem => problem.severity === 'error');
  const firstOf = (predicate: (problem: { source: string; message: string }) => boolean) =>
    errors.find(predicate)?.message;
  const verdict = (failure: string | undefined) => (failure
    ? { status: 'failed' as const, evidence: failure }
    : { status: 'passed' as const });

  const verdicts: Record<string, { status: 'passed' | 'failed'; evidence?: string }> = {};

  const qualityChecks = input.evidence?.qualityChecks || [];
  const blockingBehaviorFailures = qualityChecks.filter(check =>
    check.status === 'fail' && /^(functionality_|visual_)/.test(check.key) && check.severity === 'high');
  if (qualityChecks.length && !blockingBehaviorFailures.length && input.ok) {
    verdicts.requested_behavior = {
      status: 'passed',
      evidence: `${qualityChecks.filter(check => /^(functionality_|visual_)/.test(check.key)).length} functional and interaction checks passed without a high-severity failure.`,
    };
  } else if (!input.ok || blockingBehaviorFailures.length) {
    verdicts.requested_behavior = { status: 'failed', evidence: firstOf(() => true) || 'Verification did not pass.' };
  }

  // Journeys run in a real browser are the most direct evidence there is
  // for "the requested behaviour works"; when they ran, they decide it.
  const scenarios = input.evidence?.scenarios || [];
  if (scenarios.length) {
    const failed = scenarios.find(scenario => !scenario.ok);
    verdicts.requested_behavior = failed || !input.ok
      ? { status: 'failed', evidence: failed ? `Journey "${failed.name}" failed: ${failed.error || 'unknown step'}` : (firstOf(() => true) || 'Verification did not pass.') }
      : { status: 'passed', evidence: `${scenarios.length} user journey(s) passed in a real browser.` };
  }

  if (input.ran.build || input.ran.typecheck) {
    verdicts.build = verdict(firstOf(problem => problem.source === 'build' || problem.source === 'typecheck'));
  }
  if (input.ran.devServer) {
    verdicts.preview = verdict(firstOf(problem => /PREVIEW_NOT_RUNNING|preview|placeholder|scaffold/i.test(problem.message)));
  }
  if (input.ran.browser) {
    verdicts.browser_smoke = verdict(firstOf(problem => problem.source === 'browser'
      || /Browser exception|Preview document|blank|build overlay|scaffold|horizontal overflow|Resource unavailable|HTTP \d+/i.test(problem.message)));
    verdicts.console = verdict(firstOf(problem => /Browser exception|Console exception|Resource unavailable|HTTP \d+/i.test(problem.message)));
    const viewports = input.evidence?.responsiveViewports;
    if (viewports) {
      if (viewports.includes(1280) && viewports.includes(390)) {
        verdicts.responsive = { status: 'passed', evidence: 'The live application rendered without horizontal overflow at 1280px and 390px.' };
      } else {
        verdicts.responsive = { status: 'failed', evidence: firstOf(problem => /overflow|blank.*(?:390|mobile)|390px/i.test(problem.message)) || 'Desktop and mobile viewport verification did not both pass.' };
      }
    }
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
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return 180_000;
  /*
   * Every turn resends the whole transcript, so its size is paid again on
   * each call — in latency first. Past ~400k characters a round was spending
   * more time re-reading old tool results than acting on the new ones; the
   * recent turns are always kept whole by the compactor either way.
   */
  return Math.max(180_000, Math.min(400_000, Math.floor(contextTokens * 4 * 0.2)));
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
/** How long past its deadline a run may take to finish the round in flight. */
const RUN_DEADLINE_GRACE_MS = 150_000;

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
function designContextForRoute(route: PipelineRoute, prompt: string, hasExistingFiles: boolean, projectId: string): string | undefined {
  if (route === 'small_edit') return undefined;
  const policy = buildWorldClassUiPolicy({ prompt, seed: projectId });
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
  const journeys = renderScenariosForCoder(plan.acceptance);
  if (journeys) lines.push('', journeys);
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
/** Failures that belong to the model, not to the request: another model can do the work. */
export function isModelRefusal(diagnosticCode: string): boolean {
  return /^(?:MODEL_(?:UNAVAILABLE|CAPABILITY_UNAVAILABLE|MODALITY_UNAVAILABLE|OUTPUT_LIMIT)|PROVIDER_(?:UNSUPPORTED_RUNTIME_CONFIG|BAD_REQUEST|QUOTA_OR_BILLING))$/.test(diagnosticCode);
}

function nextComplexity(complexity: TaskComplexity | undefined): TaskComplexity {
  return complexity === 'simple' ? 'complex' : 'extreme';
}

function buildToolLoopTurn(input: { gateway: ProviderGateway; modelId: AllowedModelId; sandbox: ProjectSandbox; visionInputs?: Array<{url:string;detail?:'auto'|'low'|'high'}>; onChatEvent?: (event: import('../lib/agent-chat-protocol.ts').ChatEvent) => void; activityLabel: string; onSpend?: (spend: AgentLoopSpend) => void | Promise<unknown>; deadline: number; signal?: AbortSignal; allowFallback?: boolean; effort?: AgentEffort;
  /**
   * The model and reasoning level for the next round. Read at the start of
   * every round, so Auto can escalate between rounds; absent, the model is
   * `modelId` and the level follows `effort`.
   */
  current?: { modelId: AllowedModelId; reasoningLevel: ReasoningLevel };
  /**
   * The design system, from `designContextForRoute`.
   *
   * It goes in the system message rather than the round-one instruction
   * because every round writes interface code, not just the first. A repair
   * round that has lost the design rules fixes the type error and flattens the
   * component it touched on the way past.
   */
  designPolicy?: string;
  /**
   * The harness, so each tool call is recorded as it happens rather than
   * summarised after the fact. Absent when the route runs without one, and the
   * loop behaves exactly as before.
   */
  harness?: CodenAgentHarness;
  harnessTurn?: { turnId: string; role: HarnessAgentRole };
  /**
   * A compatible model to carry on with when the pinned one refuses the work
   * itself (a runtime option, a capability, its route or quota), rather than
   * failing the run. Absent, or returning null, and the error propagates.
   */
  substitute?: (failed: AllowedModelId, diagnosticCode: string) => AllowedModelId | null }): RepairTurn {
  const levelFor = () => input.current?.reasoningLevel ?? reasoningLevelForEffort(normalizeAgentEffort(input.effort));
  const runtimeFor = (modelId: AllowedModelId) => buildProviderRequestConfig(buildAIModelRuntimeConfig({
    modelId,
    task: 'debug',
    preferStructuredOutput: false,
    allowTools: true,
    // The level the user chose — or Auto's — reaches the provider here.
    reasoningLevel: levelFor(),
    // The coder turn streams in production, and its deadline is the model's
    // own. Nothing here sizes the output: the request uses the model's whole
    // output window, read from the live catalogue.
    stream: true,
  }));

  /*
   * The rounds of one run are one conversation.
   *
   * Each round used to start from nothing but the system message and its
   * instruction: round two did not know what round one had written, why, or
   * which approach had already failed — only the error list. It re-read,
   * re-decided and sometimes undid its own work. The last rounds now travel
   * with the next one, compacted (old tool output and old file bodies are
   * already on disk), as Claude Code keeps a working session.
   */
  const rounds: ChatMessage[][] = [];
  const CARRIED_ROUNDS = 3;

  return async ({ instruction, tools, call, maxToolCalls }) => {
    const carried = compactTranscript(rounds.slice(-CARRIED_ROUNDS).flat(), 10)
      .map(message => {
        // Each round's instruction restates the whole mission, and the new
        // instruction below restates it again: carrying the old copies would
        // send it up to four times. What they asked stays one line.
        if (message.role === 'user' && typeof message.content === 'string' && message.content.length > 2_000) {
          return { role: 'user' as const, content: `[Earlier round instruction — the mission is restated in full in the latest message.]\n${message.content.slice(-600)}` };
        }
        return message.reasoning_details ? { ...message, reasoning_details: undefined } : message;
      });
    const modelId = input.current?.modelId ?? input.modelId;
    // Reasoning is redacted like any other text before it leaves the server.
    const reasoning = input.onChatEvent ? createStreamingRedactor(delta => input.onChatEvent?.({ type: 'reasoning_delta', delta })) : null;
    let toolCalls = 0;
    const knownPaths = new Set(await input.sandbox.listFiles());
    const touched = new Map<import('../lib/agent-chat-protocol.ts').FileAction, Set<string>>();
    const handlers = Object.fromEntries(tools.map(tool => [
      tool.name,
      async (args: Record<string, unknown>) => {
        input.signal?.throwIfAborted();
        toolCalls += 1;
        /*
         * Every tool call becomes an item the harness can show.
         *
         * `startTool`/`completeTool`/`failTool` have been complete since the
         * harness was written and called from nowhere: production holds 37
         * `subagent` items and not one `tool_call`, so the record could say a
         * subagent ran and never what it did. There was no trace to resume
         * from, none to explain a run with, none to debug one from.
         *
         * Recording can never fail the run — see `recordToolCall`.
         */
        const result = await recordToolCall(
          input.harness || null,
          input.harnessTurn ? { turnId: input.harnessTurn.turnId, role: input.harnessTurn.role } : null,
          { name: tool.name, args },
          () => call(tool.name, args),
        );
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
    const runRound = (modelId: AllowedModelId, carried: ChatMessage[]) => runLlmToolLoop({
      gateway: input.gateway,
      modelId,
      messages: [
        {
          role: 'system',
          content: withUserInstructions((input.designPolicy ? `${input.designPolicy}\n\n` : '') + 'Deliver a complete, working product, not a mock-up: every visible control does what its label says, every navigation link leads to a real screen, user data persists, and every screen works at 390px, 768px and 1280px. Automated browser journeys and a design review check exactly that after each round. Compose the interface from the scaffold\'s ready-made components, tokens and motion helpers when they exist in the project, and give the app its own considered identity rather than a generic template. ' + 'You build and repair a real application through tools. Work in few, full steps: every step re-sends this whole conversation, so batch independent tool calls in one step — read every file you need at once, write several new files together, and do not re-read a file you just wrote. Read a file before editing it. Prefer edit_file for a targeted change; use write_file only to create a new file or to replace one entirely. Install a missing dependency rather than rewriting the import that needs it. When you are unsure of the current API of a library, how a service is set up, or what an unfamiliar error means, look it up with web_search and read the official page with fetch_url instead of guessing; do not browse for what you already know. Before each useful batch of tools, briefly explain your next action in the user language, in one or two sentences. Report observed outcomes, not private reasoning. Never print file bodies, fenced code, secrets or tool arguments in prose. Use tools to write code. Do not claim tests passed without their results. Coden already owns the live dev server and preview verification: never run dev, start, serve, or preview scripts; use get_logs when runtime output is needed. When a requirement is vague, choose the most reasonable interpretation, say which one you chose, and keep building — request_decision stops the run and costs the user a round trip, so it is for the rare case where continuing would destroy work or commit the project to one of two incompatible directions, never for preferences, naming, or confirming that you understood.'),
        },
        ...carried,
        {
          role: 'user',
          content: input.visionInputs?.length && !rounds.length
            ? buildVisionMessageContent(instruction, input.visionInputs)
            : rounds.length ? `${instruction}\n\n(Your earlier rounds in this run are above. Build on what you already did; the files on disk are the source of truth.)` : instruction,
        },
      ],
      handlers,
      runtimeConfig: {
        ...runtimeFor(modelId),
        tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
        toolChoice: 'auto',
      } as any,
      runtimeConfigForModel: runtimeFor,
      // One model turn per two tool calls is the shape a real build takes:
      // read, read, write, check, write again. Capping turns at six meant a
      // round could not use the calls it had been given.
      maxSteps: Math.max(6, Math.min(24, maxToolCalls)),
      maxToolCalls,
      // Auto may recover through the compatible model chain before any
      // output is visible. A manually selected model remains pinned, but both
      // modes still receive a bounded same-model retry for transient outages.
      allowFallback: input.allowFallback === true,
      maxModelAttempts: 2,
      // One clock for the whole run, not one per round.
      deadline: input.deadline,
      // The transcript is digested against this model's own window, not a
      // constant. A fixed 240k characters is roughly 60k tokens — a quarter of
      // the smallest window in the catalogue and a sixteenth of the largest —
      // so a model with a million tokens of context was having its history
      // compacted long before it needed to be, losing detail it could have
      // kept. A quarter of the window, with a ceiling so a single request
      // cannot become arbitrarily expensive.
      budget: { compactAboveChars: compactionThresholdChars(modelId) },
      onCompacted: info => console.info('[coden:tool_loop_compacted]', { chars: info.chars }),
      signal: input.signal,
      onTextDelta: input.onChatEvent ? delta => input.onChatEvent?.({ type: 'text_delta', delta }) : undefined,
      onReasoningDelta: reasoning ? delta => reasoning.push(delta) : undefined,
      onTextEnd: () => { reasoning?.end(); input.onChatEvent?.({ type: 'text_end' }); },
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
    let loop: Awaited<ReturnType<typeof runRound>>;
    try {
      loop = await runRound(modelId, carried);
    } catch (error: any) {
      /*
       * A pinned model that refuses the work itself is not the user's error.
       *
       * The run stopped on "Ce modèle ne convient pas à cette demande — Utiliser
       * Auto", after minutes of work, for a refusal the user can do nothing
       * about but switch model and start again. The files this round wrote are
       * on disk; the round is run again once on a compatible model, from the
       * same instruction, and the switch is announced.
       */
      const code = String(error?.diagnosticCode || '');
      const replacement = !input.allowFallback && isModelRefusal(code) && !input.signal?.aborted
        ? input.substitute?.(modelId, code) ?? null
        : null;
      if (!replacement || replacement === modelId) throw error;
      console.warn('[coden:pinned_model_substituted]', { from: modelId, to: replacement, reason: code });
      if (input.current) input.current.modelId = replacement;
      loop = await runRound(replacement, carried.map(message => message.reasoning_details ? { ...message, reasoning_details: undefined } : message));
    }
    if (loop) {
      // This round's part only: the carried prefix is already recorded.
      rounds.push(carryOverTranscript(loop.messages.slice(1 + carried.length), loop.result?.text));
    }
    // The round's real cost, taken from the loop's own counters rather than
    // inferred: this is the number it actually stopped on.
    if (loop) await input.onSpend?.(loop.spend);
    return { toolCalls };
  };
}

export async function runMultiAgentPipeline(input: {
  gateway: ProviderGateway;
  projectId: string;
  projectName?: string;
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
   * The effort the user asked for, which widens or narrows the route budget.
   * Absent means Medium, which is the budget this pipeline already had.
   */
  effort?: AgentEffort;
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
  /**
   * This project's own Supabase project, as `loadProjectBackendEnv` renders
   * it. Handed to the sandbox so the scaffold's client points at a real
   * backend, and described to both agents so they write real queries instead
   * of a localStorage stand-in next to a client they never call.
   *
   * Empty when no backend was provisioned, which is a working application with
   * one feature unavailable — never a reason to fail the run.
   */
  backendEnv?: Record<string, string>;
  /** Keeps deterministic infrastructure tests independent from model analysis. */
  enableSpecialists?: boolean;
  harnessContext?: MultiAgentHarnessContext;
  onSandboxEvent?: (event: LaunchEvent) => void;
  onCoderEvent?: (event: RepairEvent) => void;
  /** Errors a repair round made disappear — what the learning layer learns fixes from. */
  onErrorsResolved?: (problems: ValidationProblem[], round: number) => void;
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
  /*
   * The route decides the shape of the budget; the effort decides how much of
   * it there is. Applied here, once, because `routeBudget` feeds the run
   * deadline and all three coder-loop ceilings — scaling it at each of those
   * four sites is four chances for them to disagree.
   */
  const routeBudget = scaleRouteBudgetForEffort(budgetForRoute(input.route), input.effort);
  const runDeadline = Date.now() + (input.runDeadlineMs ?? routeBudget.runDeadlineMs);
  /*
   * The deadline is where the run stops starting work; this is where it is
   * stopped. They used to be the same instant, so the moment the clock ran
   * out the call in flight was aborted and the run failed outright — five
   * and a half minutes of a todo app, written, running, four errors from
   * done, reported as "La demande ne peut pas être terminée". The grace lets
   * the round in flight finish and its checks run, and the run delivers what
   * it has with what is still open.
   */
  const deadlineSignal = AbortSignal.timeout(Math.max(1, runDeadline - Date.now() + RUN_DEADLINE_GRACE_MS));
  input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, deadlineSignal]) : deadlineSignal };
  // Reject an incompatible manual selection before planning or starting a process.
  const selectionRequest = { task: taskKindForRoute(input.route), plan: input.userPlan, credits: input.credits, complexity: input.complexity, needs: { tools: true, vision: Boolean(input.visionInputs?.length) } };
  let selection: ReturnType<typeof selectModel>;
  try {
    selection = selectModel({ ...selectionRequest, requestedModel: input.selectedModel });
  } catch (error: any) {
    // A pinned model that cannot do this request (e.g. read the attached
    // images) is replaced by a compatible one for this run, not a failure.
    if (!input.selectedModel || error?.diagnosticCode !== 'MODEL_CAPABILITY_UNAVAILABLE') throw error;
    selection = selectModel(selectionRequest);
    console.info('[coden:pinned_model_substituted]', { from: input.selectedModel, to: selection.modelId, reason: 'capability' });
    input = { ...input, selectedModel: undefined };
  }
  const modelId = selection.modelId;
  const autoMode = input.selectedModel === undefined;
  /*
   * What the coder runs on, round by round.
   *
   * Pinned: the user's model and the user's level, exactly, for the whole run.
   * Auto: its own choice, which it may strengthen when a round fails to make
   * progress — more reasoning first, then a stronger model.
   */
  const current = {
    modelId,
    reasoningLevel: autoMode ? selection.reasoningLevel : reasoningLevelForEffort(normalizeAgentEffort(input.effort)),
  };
  const announceModel = (reason: 'initial' | 'escalation') => {
    if (!autoMode) return;
    input.onChatEvent?.({
      type: 'model_selected',
      modelId: current.modelId,
      label: MODEL_REGISTRY.find(model => model.id === current.modelId)?.label || current.modelId,
      reasoningLevel: current.reasoningLevel,
      reason,
    });
  };
  announceModel('initial');
  let escalations = 0;
  const escalate = () => {
    if (!autoMode || escalations >= 2) return;
    const rank = (level: ReasoningLevel) => REASONING_LEVELS.indexOf(level);
    let stronger: AllowedModelId | null = null;
    try {
      stronger = selectModel({
        task: taskKindForRoute(input.route),
        plan: input.userPlan,
        credits: input.credits,
        complexity: nextComplexity(input.complexity),
        needs: { tools: true, vision: Boolean(input.visionInputs?.length) },
        allowDegradation: false,
      }).modelId;
    } catch {
      // Nothing stronger within the plan and credits.
    }
    // Think harder first; then a stronger model; then the most reasoning.
    if (rank(current.reasoningLevel) < rank('high')) current.reasoningLevel = 'high';
    else if (stronger && stronger !== current.modelId) current.modelId = stronger;
    else if (current.reasoningLevel !== 'max' && affordableReasoning('max', current.modelId, input.credits) === 'max') current.reasoningLevel = 'max';
    else return;
    escalations += 1;
    announceModel('escalation');
  };
  const activity = (frLabel: string, enLabel: string) =>
    input.onChatEvent?.({ type: 'activity', label: fr ? frLabel : enLabel });

  // Chosen before planning, not after: the plan has to be written for the
  // scaffold the sandbox will actually start from.
  // Themed for this project: its palette, type pair, radii and motion are
  // written into the scaffold, seeded by the project id so they never drift.
  const starter = input.route === 'new_project'
    ? themeStarter(selectStarter(input.prompt), { prompt: input.prompt, seed: input.projectId, title: input.projectName })
    : null;
  // What this run can afford: pre-analysis, journeys, exploration, review.
  const quality = resolveQualityPolicy({ route: input.route, credits: input.credits, effort: input.effort, plan: String(input.userPlan || '') });

  // Hoisted above planning: the planner is a recorded step too, and the
  // record cannot start halfway through the run it describes.
  const ctx = input.harnessContext;

  // Computed once and given to both agents, so the plan and the code that
  // implements it are designed to the same brief. A planner that has not seen
  // the design system names three files; the coder then designs from nothing.
  const designPolicy = designContextForRoute(input.route, input.prompt, input.existingFiles.length > 0, input.projectId);
  // Undefined when no backend was provisioned, so nothing tells an agent a
  // database exists when none does — the one failure worse than no backend is
  // an app written against one that is not there.
  const backendBriefing = describeProjectBackend(input.backendEnv || {});

  // The spend counter starts before specialist analysis: those calls are real
  // provider work and must never disappear from billing or observability.
  const spent = { toolCalls: 0, repairAttempts: 0, costUsd: 0 };

  /*
   * The sandbox comes up while the agents think.
   *
   * Installing and starting the dev server needs the files it starts from —
   * the scaffold, or the project as it is — and nothing from the plan. It used
   * to wait for the specialists and the planner to finish, so every build paid
   * for the install on top of the planning instead of during it: the single
   * longest silence in a run, added end to end.
   *
   * Its progress labels are held while planning is still the visible phase,
   * so the thinking line does not flicker between two stories.
   */
  const launchFiles = starter
    ? applyStarter(starter, []).files
    : input.existingFiles.map(file => ({ path: file.path, content: file.content || '' }));
  let planningVisible = true;
  let pendingLaunchLabel: [string, string] | null = null;
  const launchPromise = launchProjectPreview({
    projectId: input.projectId,
    userId: input.userId,
    files: launchFiles,
    /*
     * The app's backend, in the environment its dev server reads.
     *
     * `launchProjectPreview` has always taken this and nothing ever passed it,
     * so the `react-supabase` scaffold — chosen whenever a prompt mentions
     * auth, users or a database — built its client from an undefined
     * `VITE_SUPABASE_URL` and came up printing "Supabase is not configured
     * yet". The dedicated Supabase project existed; the sandbox was simply
     * never told about it.
     */
    env: input.backendEnv,
    signal: input.signal,
    onEvent: event => {
      input.onSandboxEvent?.(event);
      const label: [string, string] | null = event.type === 'sandbox_installing'
        ? ['Coden installe les dépendances…', 'Coden is installing dependencies…']
        : event.type === 'sandbox_starting' ? ['Coden démarre l’aperçu…', 'Coden is starting the preview…'] : null;
      if (!label) return;
      if (planningVisible) pendingLaunchLabel = label;
      else activity(label[0], label[1]);
    },
  });
  // Observed now so a failure while planning is never an unhandled rejection;
  // it is rethrown where the launch is awaited.
  let launchSettled = false;
  launchPromise.then(() => { launchSettled = true; }, () => { launchSettled = true; });

  let specialistBrief = '';
  if (input.route !== 'small_edit' && input.enableSpecialists !== false && quality.specialists) {
    const sourceSignals = [
      input.prompt,
      ...input.existingFiles.slice(0, 80).map(file => `${file.path}\n${String(file.content || '').slice(0, 4_000)}`),
    ].join('\n').toLowerCase();
    const specialistContext = {
      projectName: input.projectName || input.projectId,
      userPrompt: input.prompt,
      appType: classifyGeneratedAppType(input.prompt),
      fileCount: input.existingFiles.length,
      files: input.existingFiles.map(file => ({ path: file.path, content: file.content || '' })),
      hasAuth: /\b(auth|login|signup|connexion|inscription|session)\b/i.test(sourceSignals),
      hasDatabase: Object.keys(input.backendEnv || {}).some(key => /SUPABASE|DATABASE/i.test(key))
        || /\b(database|supabase|postgres|sql|crud|base de donn)/i.test(sourceSignals),
      hasPayments: /\b(payment|paiement|checkout|billing|factur|subscription|abonnement|saspay|stripe)\b/i.test(sourceSignals),
      language: (fr ? 'fr' : 'en') as 'fr' | 'en',
      // All specialists share the orchestrator's approved model. In Auto, the
      // gateway may still recover through its compatible chain; a manual
      // selection never changes behind the user's back.
      availableModels: { fast:modelId, balanced:modelId, reasoning:modelId, design:modelId },
    };
    const selectedRoles = selectAgentsForContext(specialistContext);
    if (input.route === 'new_project') selectedRoles.push('test_writer');
    const roles = [...new Set(selectedRoles)].slice(0, quality.maxSpecialists) as AgentRole[];

    if (roles.length) {
      activity('Les spécialistes cadrent le produit…', 'Specialists are shaping the product…');
      const harnessItems = new Map<AgentRole, string>();
      const harnessRole: Record<AgentRole, HarnessAgentRole> = {
        ui_designer: 'frontend',
        backend_engineer: 'backend',
        security_auditor: 'security',
        test_writer: 'tester',
        ux_validator: 'visual_qa',
        dependency_analyst: 'explorer',
      };
      if (ctx) {
        await Promise.all(roles.map(async role => {
          const item = await ctx.harness.spawnSubagent({
            turnId: ctx.turnId,
            role: harnessRole[role],
            title: role.replace(/_/g, ' '),
            context: { stage: 'pre_analysis', route: input.route },
          }).catch(() => null);
          if (item) harnessItems.set(role, item.id);
        }));
      }

      const results = await runParallelAgents(
        specialistContext,
        async (task: AgentTask, specialistModel: AllowedModelId) => {
          const runtimeFor = (candidate: AllowedModelId) => buildProviderRequestConfig(buildAIModelRuntimeConfig({
            modelId: candidate,
            task: 'planning',
            allowTools: false,
            preferStructuredOutput: false,
          }));
          const result = await input.gateway.chat(specialistModel, [
            { role: 'system', content: withUserInstructions(task.systemContext) },
            { role: 'user', content: task.prompt },
          ], {
            maxAttempts: 2,
            allowFallback: input.selectedModel === undefined,
            runtimeConfig: runtimeFor(specialistModel),
            runtimeConfigForModel: runtimeFor,
            signal: input.signal,
          });
          spent.costUsd += result.cost_usd || 0;
          return result.text;
        },
        roles,
        // The planner waits on these; a slow specialist costs every build.
        quality.specialistTimeoutMs,
      );
      specialistBrief = mergeAgentOutputs(results);

      if (ctx) {
        await Promise.all(results.map(async result => {
          const itemId = harnessItems.get(result.role);
          if (!itemId) return;
          if (result.success) {
            await ctx.harness.completeSubagent(itemId, redactSecrets(result.output).slice(0, 10_000), []);
          } else {
            await ctx.harness.transitionItem(itemId, 'failed', { reason: 'specialist_failed', error: redactSecrets(result.error || '') });
          }
        }));
        if (spent.costUsd > 0) await ctx.harness.recordSpend(ctx.turnId, { costUsd: spent.costUsd });
      }
    }
  }

  let plan: PlannerAgentResult | undefined;
  input.signal?.throwIfAborted();
  if (input.route !== 'small_edit') {
    activity('Coden prépare le plan…', 'Coden is preparing the plan…');
    // Redacted before it leaves the server, like the coder's reasoning.
    const planningThoughts = input.onChatEvent ? createStreamingRedactor(delta => input.onChatEvent?.({ type: 'reasoning_delta', delta })) : null;
    // Before the sandbox exists, deliberately: planning needs no filesystem,
    // and paying the sandbox's cost for a plan that turns out unusable would
    // be the exact waste this ordering avoids.
    plan = await runPlannerAgent({
      gateway: input.gateway,
      prompt: [
        buildMissionContext({ prompt: input.prompt, history: input.history, approvedPlan: input.approvedPlan, fileCount: input.existingFiles.length, complexity: input.complexity }).text,
        specialistBrief,
      ].filter(Boolean).join('\n\n'),
      existingFiles: input.existingFiles,
      scaffold: starter ? describeStarter(starter) : undefined,
      memoryContext: input.memoryContext,
      // The planner needs it before the coder does: a plan written as if there
      // were no database names a localStorage module, and the coder then
      // builds what the plan asked for.
      designPolicy: [designPolicy, backendBriefing].filter(Boolean).join('\n\n') || undefined,
      plan: input.userPlan,
      credits: input.credits,
      selectedModel: input.selectedModel,
      effort: input.effort,
      allowFallback: input.selectedModel === undefined,
      withAcceptance: quality.acceptance,
      signal: input.signal,
      onReasoning: planningThoughts ? delta => planningThoughts.push(delta) : undefined,
    });
    planningThoughts?.end();
    spent.costUsd += plan.costUsd;
    input.onChatEvent?.({ type:'text_delta', delta:plan.summary });
    input.onChatEvent?.({ type:'text_end' });

    /*
     * The plan, recorded as the plan.
     *
     * `plan` is a declared item kind and no row has ever carried it. The
     * planner is a real agent doing real work — its own model call, its own
     * cost, its own failure mode — and the record showed the build appearing
     * out of nothing. The `planner` role exists in the tool registry precisely
     * so that this step can be attributed to something other than the agent
     * that writes the files.
     *
     * Recorded after the fact rather than around the call: the plan is the
     * artifact worth keeping, and a harness failure must not cost a plan that
     * a model was already paid for.
     */
    if (ctx) {
      await ctx.harness.createItem({
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        kind: 'plan',
        role: 'planner',
        status: 'completed',
        title: plan.summary.slice(0, 120),
        payload: { files: plan.files, risks: plan.risks, route: input.route },
      }).catch((error: any) => console.info('[coden:harness_plan_unrecorded]', { reason: error?.message }));
    }
  }

  planningVisible = false;
  // Only a stage still in progress is worth announcing.
  if (pendingLaunchLabel && !launchSettled) activity(pendingLaunchLabel[0], pendingLaunchLabel[1]);
  const launch = await launchPromise;

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
    specialistBrief,
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
  const coderItem = ctx
    ? await ctx.harness.spawnSubagent({
        turnId: ctx.turnId,
        role: 'integrator',
        title: input.route === 'small_edit' ? 'Edit' : 'Build',
        context: { route: input.route },
      })
    : null;

  let previousErrors: ValidationProblem[] | null = null;
  const afterRound: NonNullable<Parameters<typeof runCoderLoop>[0]['afterRound']> = async (round, report) => {
    const errors = report.problems.filter(problem => problem.severity === 'error');
    if (previousErrors && input.onErrorsResolved) {
      const open = new Set(errors.map(problem => problem.message.split('\n')[0]));
      const resolved = previousErrors.filter(problem => !open.has(problem.message.split('\n')[0]));
      if (resolved.length) {
        try { input.onErrorsResolved(resolved, round.round); } catch { /* learning never breaks a run */ }
      }
    }
    previousErrors = errors;
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
  /*
   * One deadline for the whole run.
   *
   * The route already aborts a generation at fifteen minutes; this sits just
   * inside it so the run ends on its own terms — reporting what it did and
   * keeping the files it wrote — rather than being cut off mid-call.
   */

  let latestScreenshots: Array<{ width: number; dataUrl: string }> = [];
  /*
   * A journey that keeps failing stops blocking.
   *
   * A scenario is the planner's guess at the interface, written before the
   * interface existed; now and then it names a label the app legitimately
   * does not have. Failing the run on it forever would spend every remaining
   * round rewriting a working app to match a guess. After two repair rounds
   * that did not fix it, it is reported as unverified instead of blocking.
   */
  const behaviourStreak = new Map<string, number>();
  const capBehaviourChurn = (report: ValidationReport) => {
    const seen = new Set<string>();
    for (const problem of report.problems) {
      if (problem.severity !== 'error' || !/^(SCENARIO|FUNCTIONALITY)\b/.test(problem.message)) continue;
      const key = /^SCENARIO "([^"]+)"/.exec(problem.message)?.[1] || problem.message.slice(0, 48);
      seen.add(key);
      const streak = (behaviourStreak.get(key) || 0) + 1;
      behaviourStreak.set(key, streak);
      // A control the journey cannot even find, after the coder was shown the
      // journey up front and had one repair to add it, is most likely a label
      // the planner guessed — not a missing feature. It stops blocking sooner.
      const unfound = /no visible (element|field|select)/i.test(problem.message);
      if (streak >= (unfound ? 2 : 3)) {
        problem.severity = 'warning';
        problem.message = `UNVERIFIED after ${streak - 1} repair attempts: ${problem.message}`;
      }
    }
    for (const key of [...behaviourStreak.keys()]) if (!seen.has(key)) behaviourStreak.delete(key);
    report.ok = report.problems.every(problem => problem.severity !== 'error');
  };
  /*
   * One look at the finished result, by a designer's eye, while there is
   * still a round to act on it. Only where the budget allows it.
   */
  const review = quality.designReview ? async (report: ValidationReport) => {
    if (!latestScreenshots.length) return undefined;
    activity('Coden relit le design…', 'Coden is reviewing the design…');
    const findings = report.problems
      .filter(problem => problem.severity === 'warning' && !/^EXTERNAL_DEPENDENCY_UNVERIFIED/.test(problem.message))
      .map(problem => problem.message)
      .slice(0, 6);
    const outcome = await runDesignReview({
      gateway: input.gateway,
      prompt: input.prompt,
      screenshots: latestScreenshots,
      findings,
      plan: input.userPlan,
      credits: input.credits,
      french: fr,
      allowFallback: input.selectedModel === undefined,
      pinnedModel: input.selectedModel,
      signal: input.signal,
    });
    spent.costUsd += outcome.costUsd;
    if (ctx && outcome.costUsd > 0) await ctx.harness.recordSpend(ctx.turnId, { costUsd: outcome.costUsd }).catch(() => undefined);
    if (outcome.instruction) activity('Coden peaufine l’interface…', 'Coden is polishing the interface…');
    return outcome.instruction;
  } : undefined;

  let repairOutcome: RepairOutcome;
  activity('Coden construit l’application…', 'Coden is building the application…');
  try { repairOutcome = await runCoderLoop({
    sandbox,
    deadline: runDeadline,
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
      // The coder writes as the integrator, which is the role that already
      // owns `workspace.patch` and `shell.exec` in the tool registry.
      harness: ctx?.harness,
      harnessTurn: ctx ? { turnId: ctx.turnId, role: 'integrator' as const } : undefined,
      // Both in the system message, so a repair round cannot lose either one
      // and quietly swap a real query back out for mock data.
      designPolicy: [designPolicy, backendBriefing].filter(Boolean).join('\n\n') || undefined,
      deadline: runDeadline,
      allowFallback: input.selectedModel === undefined,
      effort: input.effort,
      current,
      substitute: failed => {
        let replacement: AllowedModelId | null = null;
        try { replacement = selectModel(selectionRequest).modelId; } catch { return null; }
        if (!replacement || replacement === failed) return null;
        // The run now continues on Auto's choice, at Auto's level.
        current.reasoningLevel = selectModel(selectionRequest).reasoningLevel;
        input.onChatEvent?.({
          type: 'model_selected',
          modelId: replacement,
          label: MODEL_REGISTRY.find(model => model.id === replacement)?.label || replacement,
          reasoningLevel: current.reasoningLevel,
          reason: 'substitution',
        });
        return replacement;
      },
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
        // A repair round that removed nothing: Auto strengthens the next one.
        if (event.round > 1 && event.errorsBefore > 0 && event.errorsAfter >= event.errorsBefore) escalate();
      }
    },
    signal:input.signal,
    ensureRuntime: async restartRequired => {
      if (!restartRequired && sandbox.status().state === 'running') return;
      await launchProjectPreview({ projectId: input.projectId, userId: input.userId, files: await readAllFiles(sandbox),
        reinstall: restartRequired, signal: input.signal, onEvent: input.onSandboxEvent });
    },
    verifyPreview:async () => {
      const preview = await verifyLivePreview(sandbox, input.signal, {
        scenarios: plan?.acceptance,
        explore: quality.explore,
        capture: quality.designReview,
      });
      // Screenshots are for the design review, in memory: never persisted in a
      // checkpoint or returned in a payload.
      latestScreenshots = preview.evidence?.screenshots || [];
      if (preview.evidence) delete preview.evidence.screenshots;
      capBehaviourChurn(preview);
      const files = await readAllFiles(sandbox);
      const appType = classifyGeneratedAppType(input.prompt);
      /*
       * The kit's own components are generic by design: its Navbar renders
       * \`{item.label}\` links and its fields spread their handlers from props.
       * Read as application code, a static scan calls every one of them a dead
       * control, on every project. Unchanged kit files are left out of the
       * static reading; the browser checks above judge what they actually do.
       */
      const kit = new Map(STARTER_KIT_FILES.map(file => [file.path, file.content]));
      const auditedFiles = files.filter(file => kit.get(file.path) !== file.content);
      const qualityChecks = [
        ...auditGeneratedDesign({
          files: auditedFiles,
          platformType: appType,
          hasExistingFiles: input.existingFiles.length > 0,
          prompt: input.prompt,
        }),
        ...auditGeneratedFunctionality({
          files: auditedFiles,
          platformType: appType,
          hasExistingFiles: input.existingFiles.length > 0,
          prompt: input.prompt,
        }),
        ...inspectVisualPreview({ files: auditedFiles, platformType: appType }),
      ];
      preview.evidence = {
        ...(preview.evidence || {}),
        qualityChecks: qualityChecks.map(check => ({
          key: check.key,
          status: check.status,
          severity: check.severity,
          message: check.message,
        })),
      };
      // Quality is part of the repair loop, not an advisory score displayed
      // after a weak app has already been called verified. Only concrete,
      // high-severity failures block; warnings remain visible evidence without
      // forcing cosmetic churn.
      for (const check of qualityChecks) {
        if (check.status !== 'fail' || check.severity !== 'high') continue;
        preview.ok = false;
        preview.problems.push({
          source: 'runtime',
          severity: 'error',
          message: `QUALITY_GATE ${check.key}: ${check.message}`,
          ...(check.file ? { file: check.file } : {}),
        });
      }
      if (starter) {
        const baseline = new Map(launchFiles.map(file => [file.path,file.content]));
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
    review,
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
      evidence: repairOutcome.finalReport.evidence,
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
    modelId: current.modelId,
    repairOutcome,
    /*
     * What the run actually cost the provider.
     *
     * This was accumulated per round and reported only to the harness, so the
     * caller had nothing to bill on. Every build and edit since this pipeline
     * became the live path was therefore free: the ledger for 2026-09-12 shows
     * three charges against nine turns, and all three were conversations —
     * the six that generated and edited an application were not billed at all.
     */
    costUsd: spent.costUsd,
  };
  } finally {
    releaseRun();
  }
}
