/**
 * Which quality checks may send a working app back for another round.
 *
 * The verification after each round runs static checks written for particular
 * kinds of product (a cart for a shop, a record list for a CRM) and adds up
 * scores. The kind was guessed from a keyword in the request, and the guess was
 * wrong on plain requests: « opérations » made a calculator a CRM, a to-do list
 * was read as a shop. The checks then demanded records, filters and carts nobody
 * asked for, and the agent kept adding them — 232 and 323 tool calls on a task
 * list, a calculator that kept getting a new interface.
 *
 * Two rules. The kind of product counts only when the request clearly names it;
 * otherwise only the generic checks apply. And checks about taste (an overused
 * gradient, a score, placeholder copy) are shown as evidence but never block.
 *
 * `CODEN_STRICT_QUALITY_GATES=1` restores the earlier behaviour.
 */
import { detectAppKind } from './app-playbook.ts';
import { classifyGeneratedAppType, type GeneratedAppType } from './design-generation-policy.ts';

export const ADVISORY_QUALITY_CHECK = /^(?:design_(?:platform_fit|no_ai_gradient|no_generic_copy|no_emoji_icons|score)|functionality_score|visual_interaction_probe_score)$/;

export function strictQualityGates(env: Record<string, string | undefined> = process.env): boolean {
  return env.CODEN_STRICT_QUALITY_GATES === '1';
}

/** The product kind the product-specific checks are held to: the guess only when the request clearly says it. */
export function gatePlatformType(prompt: string, strict = strictQualityGates()): GeneratedAppType {
  if (strict || detectAppKind(prompt)) return classifyGeneratedAppType(prompt);
  return 'generic_web_app';
}

export function blocksTheRun(check: { key: string; status: string; severity: string }, strict = strictQualityGates()): boolean {
  if (check.status !== 'fail' || check.severity !== 'high') return false;
  return strict || !ADVISORY_QUALITY_CHECK.test(check.key);
}
