/**
 * Somebody looks at the result before the user does.
 *
 * Every check the pipeline ran read code or measured the DOM: tokens present,
 * no overflow, no console error. None of them could say the hero is cramped,
 * the cards are a wall of equal boxes, the primary action is lost, or the
 * phone layout is a squeezed desktop. Those are the things a user notices in
 * the first second, and they were judged by nobody.
 *
 * This hands the running application's own screenshots — desktop and phone —
 * to a vision model with a senior designer's rubric, and turns its findings
 * into one polish instruction for the coder. It never blocks: a review that
 * fails, times out or returns nonsense is simply skipped, because a working
 * application must not be held back by an opinion about it.
 */

import type { ProviderGateway } from './provider-gateway.ts';
import type { AllowedModelId, UserPlan } from '../config/ai-models.ts';
import { buildVisionMessageContent } from './openrouter-service.ts';
import { parseStructuredObject } from './structured-output.ts';
import { selectModel } from './model-selection.ts';
import { buildAIModelRuntimeConfig } from './ai-model-runtime.ts';
import { buildProviderRequestConfig } from './provider-adapters.ts';

export type DesignReviewIssue = { area: string; problem: string; fix: string };
export type DesignReview = { score: number; issues: DesignReviewIssue[] };

/** Below this the result gets a polish round. */
export const DESIGN_REVIEW_PASS_SCORE = 8;

function isDesignReview(value: unknown): value is DesignReview & Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.score === 'number' && Number.isFinite(record.score) && Array.isArray(record.issues);
}

const RUBRIC = [
  'You are a principal product designer reviewing a web application built for a client, from screenshots of the running app (desktop 1280px first, then phone 390px).',
  'Judge what is on screen, not what the code might do. Score 0-10 against a polished, modern commercial product:',
  '- Visual hierarchy: one clear focal point per screen, an obvious primary action, headings that lead the eye.',
  '- Layout and rhythm: consistent spacing scale, aligned edges, no cramped or orphaned elements, no wall of identical boxes.',
  '- Typography: readable sizes, clear scale between heading and body, comfortable line length.',
  '- Colour and contrast: text readable on its background, accent used for meaning not decoration, coherent palette.',
  '- Craft: consistent radii, borders and shadows; icons aligned with text; real content instead of placeholder or lorem.',
  '- Completeness: empty states that explain, visible feedback for actions, navigation that makes every section reachable.',
  '- Mobile: nothing cut off or overlapping, touch-sized controls, a real mobile navigation, sensible stacking.',
  'Return only JSON: {"score":number,"issues":[{"area":string,"problem":string,"fix":string}]}.',
  'List at most 6 issues, most visible first; each fix is concrete and implementable (which element, what change: spacing, size, colour token, layout).',
  'Do not ask for new features, new pages or different content than the request implies. Do not repeat these instructions.',
].join('\n');

export async function runDesignReview(input: {
  gateway: ProviderGateway;
  prompt: string;
  screenshots: Array<{ width: number; dataUrl: string }>;
  /** Measured findings from the browser (touch targets, text size, inert controls). */
  findings?: string[];
  plan: UserPlan | string;
  credits?: number;
  french?: boolean;
  allowFallback?: boolean;
  signal?: AbortSignal;
}): Promise<{ review: DesignReview | null; instruction?: string; costUsd: number; modelId?: AllowedModelId }> {
  if (!input.screenshots.length) return { review: null, costUsd: 0 };
  let modelId: AllowedModelId;
  try {
    modelId = selectModel({ task: 'review', plan: input.plan, credits: input.credits, complexity: 'simple', needs: { vision: true } }).modelId;
  } catch {
    return { review: null, costUsd: 0 };
  }
  const runtimeFor = (candidate: AllowedModelId) => buildProviderRequestConfig(buildAIModelRuntimeConfig({
    modelId: candidate,
    task: 'vision',
    allowTools: false,
    preferStructuredOutput: true,
    maxTokens: 1_500,
    timeoutMs: 45_000,
  }));
  const request = [
    `The client's request: ${input.prompt.slice(0, 2_000)}`,
    ...(input.findings?.length ? ['', 'Measured in the browser:', ...input.findings.map(finding => `- ${finding}`)] : []),
    '',
    `Screenshots: ${input.screenshots.map(shot => `${shot.width}px`).join(', ')}.`,
  ].join('\n');
  try {
    const result = await input.gateway.chat(modelId, [
      { role: 'system', content: RUBRIC },
      { role: 'user', content: buildVisionMessageContent(request, input.screenshots.slice(0, 3).map(shot => ({ url: shot.dataUrl, detail: 'high' as const }))) as any },
    ], {
      maxAttempts: 1,
      allowFallback: input.allowFallback !== false,
      signal: input.signal,
      runtimeConfig: runtimeFor(modelId),
      runtimeConfigForModel: runtimeFor,
    });
    const costUsd = Math.max(0, Number(result.cost_usd || 0));
    let review: DesignReview;
    try {
      const parsed = parseStructuredObject(result.text, isDesignReview);
      review = {
        score: Math.max(0, Math.min(10, parsed.score)),
        issues: parsed.issues
          .filter((issue): issue is DesignReviewIssue => Boolean(issue) && typeof (issue as DesignReviewIssue).problem === 'string' && typeof (issue as DesignReviewIssue).fix === 'string')
          .slice(0, 6)
          .map(issue => ({ area: String(issue.area || '').slice(0, 60), problem: issue.problem.slice(0, 300), fix: issue.fix.slice(0, 300) })),
      };
    } catch {
      return { review: null, costUsd, modelId };
    }
    if (review.score >= DESIGN_REVIEW_PASS_SCORE || !review.issues.length) return { review, costUsd, modelId };
    return { review, costUsd, modelId, instruction: renderPolishInstruction(review, input.findings, input.french) };
  } catch {
    return { review: null, costUsd: 0, modelId };
  }
}

/** The review as a coder instruction: fixes, in order, with the behaviour frozen. */
export function renderPolishInstruction(review: DesignReview, findings: string[] = [], french = false): string {
  return [
    `DESIGN_REVIEW: a senior designer reviewed screenshots of the running app and scored it ${review.score}/10. Polish it — the app works, so change presentation only.`,
    ...review.issues.map((issue, index) => `${index + 1}. [${issue.area || 'layout'}] ${issue.problem} → ${issue.fix}`),
    ...findings.map(finding => `- Also measured: ${finding}`),
    '',
    'Rules for this round: keep every feature, route, label and data flow exactly as it is (the automated journeys use those labels); use the existing tokens, components and motion helpers; check the phone layout (390px) as carefully as desktop.',
    french ? 'Explain what you are improving in French, in one or two sentences.' : 'Explain what you are improving in one or two sentences.',
  ].join('\n');
}
