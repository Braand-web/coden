/**
 * When the intent is clear enough to skip the model router.
 *
 * Every message paid for a routing call: a 54,000-character system prompt to
 * produce a small JSON object saying "this is a build". It is also a single
 * point of failure — production logged three "returned no valid intent
 * decision" failures in one morning, and on each of them the run fell back to
 * the heuristic anyway.
 *
 * Measured on the project's own 55-case intent eval, the heuristic agreed with
 * the intended routing on all 55, and on the 40 it rated at 0.90 or above it
 * was correct every time. That eval is the heuristic's own test file, so the
 * score is partly circular and the threshold here is deliberately conservative:
 * the model still runs on anything ambiguous, anything asking for
 * clarification, and anything the user explicitly steered.
 *
 * The point is not to remove the model. It is to stop paying for it on
 * "bonjour" and "change la couleur du bouton en bleu", and to stop letting a
 * routing outage decide whether a build request becomes a chat reply.
 */

export type ShortcutUnderstanding = {
  confidence?: number;
  needsClarification?: boolean;
  action?: string;
  category?: string;
  allowsFileAction?: boolean;
};

export type RouterShortcut = {
  /** True when the heuristic may decide alone. */
  skipModel: boolean;
  /** Why, for the run log. Never shown to the user. */
  reason: string;
};

/**
 * Only the band the heuristic was measured correct on, and only when nothing
 * about the request asks for more thought.
 */
export const ROUTER_SHORTCUT_CONFIDENCE = 0.9;

export function canRouteWithoutModel(
  understanding: ShortcutUnderstanding | null | undefined,
  requestedMode?: string | null,
): RouterShortcut {
  const mode = String(requestedMode || 'auto').toLowerCase();
  // An explicit mode is the user steering; it is already deterministic
  // upstream, and second-guessing it here would only add a branch.
  if (mode !== 'auto') return { skipModel: false, reason: 'explicit_mode' };

  if (!understanding) return { skipModel: false, reason: 'no_understanding' };

  // A request the heuristic wants to ask about is exactly the kind the model is
  // worth paying for.
  if (understanding.needsClarification) return { skipModel: false, reason: 'needs_clarification' };

  const confidence = Number(understanding.confidence);
  if (!Number.isFinite(confidence) || confidence < ROUTER_SHORTCUT_CONFIDENCE) {
    return { skipModel: false, reason: 'low_confidence' };
  }

  // "other" is what the classifier returns when it recognised nothing in
  // particular. High confidence in having recognised nothing is not confidence.
  const category = String(understanding.category || '').toLowerCase();
  if (!category || category === 'other' || category === 'unknown') {
    return { skipModel: false, reason: 'unrecognised_category' };
  }

  return { skipModel: true, reason: `heuristic_confident:${category}` };
}
