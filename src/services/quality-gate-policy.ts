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
import { classifyGeneratedAppType, classifyGeneratedAppTypeScored, type GeneratedAppType } from './design-generation-policy.ts';

export const ADVISORY_QUALITY_CHECK = /^(?:design_(?:platform_fit|no_ai_gradient|no_generic_copy|no_emoji_icons|score)|functionality_score|visual_interaction_probe_score)$/;

export function strictQualityGates(env: Record<string, string | undefined> = process.env): boolean {
  return env.CODEN_STRICT_QUALITY_GATES === '1';
}

/** Kinds whose own checks are light and whose name in a request is unmistakable (« landing page », « kanban », « jeu »). */
const SELF_EVIDENT_KINDS: ReadonlySet<GeneratedAppType> = new Set<GeneratedAppType>([
  'landing_page', 'portfolio', 'admin_panel', 'gaming_creative', 'productivity_tool', 'creative_tool', 'data_tool', 'communication_tool', 'directory_listing', 'mobile_first_app',
]);

/**
 * The product kind the product-specific checks are held to.
 *
 * Every kind is scored by its own words, and the best one counts when it is backed — by two of its words, by the
 * request clearly naming the product, or by being a kind whose name is unmistakable. A single stray word of a heavy
 * kind (a cart, a clinic, a pipeline) is not a product: the checks stay generic.
 */
export function gatePlatformType(prompt: string, strict = strictQualityGates()): GeneratedAppType {
  if (strict) return classifyGeneratedAppType(prompt);
  const { type, hits } = classifyGeneratedAppTypeScored(prompt);
  if (type === 'generic_web_app') return type;
  return hits >= 2 || SELF_EVIDENT_KINDS.has(type) || detectAppKind(prompt) ? type : 'generic_web_app';
}

export function blocksTheRun(check: { key: string; status: string; severity: string }, strict = strictQualityGates()): boolean {
  if (check.status !== 'fail' || check.severity !== 'high') return false;
  return strict || !ADVISORY_QUALITY_CHECK.test(check.key);
}

/**
 * A request for something small: a calculator, a timer, a to-do list, anything said to be « mini » or « simple ».
 * It is finished when it works. No designer's second look, no polish round: the review only ever found another interface.
 */
const SMALL_WORD = /\b(?:mini|simple|simples|petit|petite|basique|basic|small|tiny|minimal|minimaliste|rapide|quick)\b/i;
const SMALL_TOOL = /\b(?:calculatrice|calculator|chronom[èe]tre|stopwatch|minuteur|timer|compte [àa] rebours|countdown|convertisseur|converter|to-?do|liste de t[âa]ches|pense-b[êe]te|lanceur de d[ée]s?|dice|pile ou face|coin flip|g[ée]n[ée]rateur de mot de passe|password generator|compteur|counter)\b/i;

export function isSmallRequest(prompt: string): boolean {
  const text = String(prompt || '').trim();
  if (!text) return false;
  return SMALL_WORD.test(text) || (text.length <= 100 && SMALL_TOOL.test(text));
}
