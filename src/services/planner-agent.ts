/**
 * Deciding what to build before building it.
 *
 * The old generation path had no separate planning step: a prompt went
 * straight into one call that was also expected to produce the whole
 * application, so there was nothing for a user to approve or correct before
 * code existed. `AgentNextAction` already has `'plan_then_build'`, and the
 * client already renders a plan and a confirm button (`agent-run-panel.tsx`,
 * `onBuildPlan`) — nothing has ever populated `AgentPlan` with a real one.
 *
 * This produces that plan: a short summary, the files the coder loop is
 * about to touch, and why each one — the minimum a person can actually read
 * and approve, not a restatement of the architecture policy that produced it.
 *
 * One call, no tools. Planning does not need a filesystem — it runs before
 * the sandbox exists — and it must not be tempted to write anything itself;
 * that discipline is what keeps `runCoderLoop`'s first round the only place
 * a file gets created.
 */

import type { ChatMessage } from './openrouter-service.ts';
import type { ProviderGateway } from './provider-gateway.ts';
import { parseOrRepairStructuredObject } from './structured-output.ts';
import { selectModelForAgent } from './model-selection.ts';
import { CODEN_ARCHITECT_POLICY, CODEN_SENIOR_AGENT_OS_POLICY } from './agent-prompt-stack.ts';
import type { UserPlan } from '../config/ai-models.ts';

export type BuildPlanFile = {
  path: string;
  action: 'create' | 'edit' | 'delete';
  /**
   * Why this file, in one sentence. Maps to `CodenPlanStep.title` /
   * `AgentPlanStep.title` at the point a plan is emitted as an SSE event —
   * the planner's job is to produce the fact, not to pre-shape it for one
   * particular renderer.
   */
  rationale: string;
};

export type BuildPlan = {
  summary: string;
  files: BuildPlanFile[];
  /**
   * Optional on the type because `isBuildPlan` accepts a model response that
   * omitted it — "nothing worth flagging" is a legitimate answer, not a
   * malformed one. `runPlannerAgent`'s return value always has it populated
   * (normalized to `[]` when absent); this only describes what passing
   * `isBuildPlan` actually guarantees.
   */
  risks?: string[];
};

function isBuildPlanFile(value: unknown): value is BuildPlanFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return typeof file.path === 'string' && file.path.trim().length > 0
    && (file.action === 'create' || file.action === 'edit' || file.action === 'delete')
    && typeof file.rationale === 'string' && file.rationale.trim().length > 0;
}

/**
 * Whether a parsed object is a usable plan.
 *
 * `risks` is optional here and normalized to `[]` by `runPlannerAgent` — a
 * model that sees nothing worth flagging should not have to invent one to
 * satisfy the shape.
 */
export function isBuildPlan(value: unknown): value is BuildPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.summary === 'string' && plan.summary.trim().length > 0
    && Array.isArray(plan.files) && plan.files.length > 0 && plan.files.every(isBuildPlanFile)
    && (plan.risks === undefined || (Array.isArray(plan.risks) && plan.risks.every(risk => typeof risk === 'string')));
}

const PLAN_JSON_CONTRACT = [
  'Output contract:',
  'Return only valid JSON with this exact shape: {"summary":string,"files":[{"path":string,"action":"create"|"edit"|"delete","rationale":string}],"risks":string[]}.',
  'Do not wrap the JSON in Markdown fences. Do not include prose before or after it.',
  'summary is one or two sentences describing what will exist once the plan is built — not a restatement of the request.',
  'files lists every file the build will create, edit, or delete. Name real paths (e.g. "src/components/Cart.tsx"), never placeholders like "TBD" or "various files".',
  'For an edit to an existing file, rationale names what changes and why — enough for someone who has not seen the request to understand the file’s role in the plan.',
  'List only files the request actually requires. A plan that touches every file in the project for a one-line request is not a plan, it is a regeneration wearing one.',
  'risks is a short list of genuine uncertainties (a missing integration, an ambiguous requirement, a destructive change) — omit it, or leave it empty, when there are none. Never pad it to look thorough.',
  'This is a plan, not the implementation. Do not include file contents, code blocks, or diffs.',
].join('\n');

function buildPlannerSystemPrompt(): string {
  return [
    CODEN_SENIOR_AGENT_OS_POLICY,
    CODEN_ARCHITECT_POLICY,
    'Planning-only context:',
    'You are producing a plan for a human to approve before any code is written. You will not write files yourself, and no other model call will invent files this plan omits — list every one the work needs.',
    PLAN_JSON_CONTRACT,
  ].join('\n\n');
}

function describeExistingFiles(files: Array<{ path: string }>): string {
  if (!files.length) return 'This is a new project. Nothing exists yet.';
  const paths = files.map(file => file.path);
  return `Existing project files (${paths.length}):\n${paths.slice(0, 200).join('\n')}${paths.length > 200 ? `\n... and ${paths.length - 200} more` : ''}`;
}

function buildPlannerUserMessage(prompt: string, existingFiles: Array<{ path: string }>): string {
  return [
    `Request: ${String(prompt || '').trim()}`,
    '',
    describeExistingFiles(existingFiles),
  ].join('\n');
}

export type PlannerAgentInput = {
  gateway: ProviderGateway;
  prompt: string;
  existingFiles: Array<{ path: string; content?: string }>;
  plan: UserPlan | string;
  credits?: number;
  signal?: AbortSignal;
};

export async function runPlannerAgent(input: PlannerAgentInput): Promise<BuildPlan & { risks: string[] }> {
  const modelId = selectModelForAgent('planner', { plan: input.plan, credits: input.credits }).modelId;
  const systemPrompt = buildPlannerSystemPrompt();
  const userMessage = buildPlannerUserMessage(input.prompt, input.existingFiles);

  const result = await input.gateway.chat(modelId, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ], { maxAttempts: 2, timeoutMs: 45_000, signal: input.signal });

  const parsed = await parseOrRepairStructuredObject(result.text, isBuildPlan, async invalidText => {
    const repaired = await input.gateway.chat(modelId, [
      { role: 'system', content: `${systemPrompt}\n\nRepair the invalid plan below. Return one valid JSON object only, matching the required contract.` },
      { role: 'user', content: String(invalidText || '').slice(0, 8_000) },
    ], { maxAttempts: 1, timeoutMs: 45_000, signal: input.signal });
    return repaired.text;
  });

  // Normalized here so every downstream reader can rely on the array
  // existing rather than re-deriving the same `|| []` at each call site.
  return { ...parsed, risks: parsed.risks || [] };
}
