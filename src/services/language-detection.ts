import { normalizeExecutionText } from './execution-contract.ts';

/**
 * Which language to answer a user in.
 *
 * This existed six times over — in `server.ts`, `agent-execution-os.ts`,
 * `execution-contract.ts`, `multi-agent-pipeline.ts`, `typed-intent-router.ts`
 * and `conflict-detector.ts` — as six regexes that had drifted apart. Five
 * carried the articles (`le`, `la`, `une`, `des`) and the imperatives users
 * actually type (`ajoute`, `modifie`); the sixth, the one on the user-visible
 * reply path in `server.ts`, carried neither.
 *
 * A real session on 2026-09-12 is what that cost. A French user wrote:
 *
 *   cree une mini to do list      → answered in French
 *   corrige le bug                → answered in French
 *   rien ne saffiche a lecran     → answered in ENGLISH
 *   change la couleur du bouton   → answered in ENGLISH
 *   ajoute une landing page       → answered in ENGLISH
 *   ajoute des animations         → answered in ENGLISH
 *
 * Every miss is a word the other five lists had. The language did not flip
 * because the user changed how they wrote; it flipped because a second-person
 * pronoun or an explicit verb like `cree` happened to fall out of the sentence.
 *
 * So this is one function, in one place, and the drift cannot resume. Adding a
 * word here fixes every caller at once — which is the entire point.
 */

/*
 * Function words carry the signal, not vocabulary: articles, pronouns,
 * prepositions and the imperatives a builder's users type. Content words are
 * deliberately absent — "application", "animation", "page" and "table" are
 * spelled identically in both languages and would call English text French.
 */
const FRENCH_MARKERS = [
  // Articles and determiners — the densest signal in any French sentence.
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'au', 'aux', 'ce', 'cette', 'ces',
  // Pronouns and possessives.
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre', 'votre',
  // Prepositions, conjunctions and negation.
  'dans', 'avec', 'pour', 'sur', 'sous', 'entre', 'chez', 'vers', 'sans',
  'mais', 'donc', 'car', 'puis', 'ensuite', 'aussi', 'alors', 'rien', 'pas',
  'que', 'qui', 'quoi', 'quand', 'comment', 'pourquoi', 'ou', 'est',
  // The imperatives this product exists to receive.
  'cree', 'creer', 'genere', 'generer', 'ajoute', 'ajouter', 'modifie', 'modifier',
  'corrige', 'corriger', 'supprime', 'supprimer', 'change', 'changer',
  'publie', 'publier', 'affiche', 'afficher', 'refais', 'continue', 'continu',
  'veux', 'voudrais', 'aimerais', 'peux', 'fais', 'faire', 'mets', 'mettre',
  // Greetings and courtesies, which often arrive alone.
  'bonjour', 'salut', 'merci', 'oui', 'non', 'stp',
];

const FRENCH_PATTERN = new RegExp(`\\b(${FRENCH_MARKERS.join('|')})\\b`);

/*
 * A few markers are also English words — `on`, `est`, `sur`, `pas`, `ou`,
 * `son`, `car`, `change`, `continue`, `mets`. Alone they must not outvote an
 * otherwise English sentence, so a match on one of those only counts when
 * nothing distinctly English surrounds it.
 */
const AMBIGUOUS = new Set(['on', 'est', 'sur', 'pas', 'ou', 'son', 'car', 'change', 'continue', 'mets', 'the']);

const ENGLISH_MARKERS = /\b(the|and|is|are|was|were|this|that|with|from|have|has|please|make|build|create|add|fix|change it|of|to|for|my|your|it|can|you|i)\b/;

/**
 * True when the text is more likely French than English.
 *
 * Accented characters settle it outright: no English sentence carries them,
 * and `normalizeExecutionText` strips them, so they are read before it runs.
 */
export function isFrenchText(value: string): boolean {
  const raw = String(value || '');
  if (/[àâäçéèêëîïôöùûüÿœæ]/i.test(raw)) return true;

  const text = normalizeExecutionText(raw);
  if (!text) return false;

  const matches = text.match(new RegExp(FRENCH_PATTERN.source, 'g')) || [];
  if (!matches.length) return false;

  // An unambiguous French marker is decisive on its own.
  if (matches.some(word => !AMBIGUOUS.has(word))) return true;

  // Otherwise the only evidence is a word both languages share: believe it
  // only when nothing English is competing with it.
  return !ENGLISH_MARKERS.test(text);
}
