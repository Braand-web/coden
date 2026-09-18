/**
 * Reading a questionnaire off the wire, and writing the answers back as text.
 *
 * The harness speaks to the model in prose, so a set of answers has to become
 * one instruction before it can be sent. Both directions are pure functions
 * here rather than inside the card, so they can be tested without a DOM and
 * reused by anything else that needs to ask several things at once.
 */

import type { DecisionAnswer, DecisionQuestion } from './agent-chat-protocol';

const MAX_QUESTIONS = 12;
const MAX_OPTIONS = 12;
const MAX_TEXT = 400;

function trimmed(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/**
 * The questions a `decision_required` event actually carries, or none.
 *
 * A question with no options is a prompt the card cannot answer — every row it
 * would draw comes from `options` — and an event with no usable question at
 * all has to fall back to the single-question notice rather than render an
 * empty card. Returning `[]` for anything malformed makes that fallback the
 * default instead of something each caller has to remember.
 */
export function normalizeDecisionQuestions(value: unknown): DecisionQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions: DecisionQuestion[] = [];
  for (const entry of value.slice(0, MAX_QUESTIONS)) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<DecisionQuestion>;
    const q = trimmed(candidate.q, MAX_TEXT);
    if (!q) continue;
    const options = Array.isArray(candidate.options)
      ? candidate.options.map(option => trimmed(option, MAX_TEXT)).filter(Boolean).slice(0, MAX_OPTIONS)
      : [];
    if (!options.length) continue;
    questions.push({ q, type: candidate.type === 'check' ? 'check' : 'radio', options });
  }
  return questions;
}

/**
 * The answers as one instruction.
 *
 * Questions left unanswered are named as skipped rather than dropped: an agent
 * that sees two answers to three questions cannot tell whether the third was
 * never asked or deliberately passed on, and those call for opposite
 * behaviour — ask again, or decide for yourself.
 */
export function composeDecisionInstruction(
  questions: readonly DecisionQuestion[],
  answers: Record<number, DecisionAnswer>,
): string {
  const lines: string[] = [];
  questions.forEach((question, index) => {
    const answer = answers[index];
    const chosen = (answer?.selected ?? [])
      .map(option => question.options[option])
      .filter((label): label is string => Boolean(label));
    const typed = answer?.custom?.trim() || '';
    lines.push(`${index + 1}. ${question.q}`);
    if (chosen.length) lines.push(`   → ${chosen.join(', ')}`);
    if (typed) lines.push(`   → ${typed}`);
    if (!chosen.length && !typed) lines.push('   → (sans réponse — décide toi-même)');
  });
  if (!lines.length) return '';
  return ['Mes réponses :', '', ...lines].join('\n');
}
