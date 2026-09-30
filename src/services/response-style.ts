/**
 * How Coden's agents talk to people.
 *
 * Four things people notice: the answer is short and points at what to do; it
 * says what was verified and what is only assumed; it speaks in plain words
 * (never a tool name, an identifier or a generated file name); and it sounds
 * like the same assistant whichever model happens to be working. This module
 * holds the guide every model is given, the small deterministic guards on what
 * reaches the person, and the rubric the answers are graded against.
 *
 * `CODEN_RESPONSE_STYLE=0` takes the guide and the guards away, and every
 * agent talks as it did before.
 */

export function responseStyleEnabled(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): boolean {
  return env.CODEN_RESPONSE_STYLE !== '0';
}

export type UserLevel = 'beginner' | 'developer' | 'unknown';

const DEVELOPER_SIGNS = /\b(?:typescript|javascript|react|vite|tailwind|npm|pnpm|yarn|git|github|docker|api|endpoint|webhook|regex|sql|postgres|supabase|jwt|oauth|cors|ssr|hydration|hook|useeffect|usestate|props?|component(?:s)?|composant(?:s)?|refactor|middleware|schema|schéma|migration|deploy(?:ment)?|d[ée]ploiement|repo|branch|commit|pull request|lint|build|bundle|css grid|flexbox|async|await|promise|stack trace|console|debug|typecheck|tsc)\b|```|=>|\bconst\b|\bimport\b/i;
const BEGINNER_SIGNS = /\b(?:d[ée]butant|debutant|beginner|no[- ]?code|je ne sais pas (?:coder|programmer)|je ne suis pas (?:d[ée]veloppeur|developpeur|technique)|i(?:'m| am) not (?:a )?(?:developer|technical|coder)|pas de code|sans (?:coder|code)|c['’]est quoi|qu['’]est-ce que|what is a|what does .* mean|je ne comprends pas)\b/i;

/** The person's level, read from what they wrote. Unsure is unsure: the default register is plain and complete. */
export function detectUserLevel(userMessages: readonly string[]): UserLevel {
  const text = userMessages.slice(-8).join('\n');
  if (!text.trim()) return 'unknown';
  if (BEGINNER_SIGNS.test(text)) return 'beginner';
  const technical = (text.match(new RegExp(DEVELOPER_SIGNS.source, 'gi')) || []).length;
  if (technical >= 3) return 'developer';
  return 'unknown';
}

const LEVEL_LINES: Record<UserLevel, string> = {
  beginner: 'The person is not a developer: no jargon at all, explain what a result means for their app in one plain sentence, and offer the next step as something they can click or say.',
  developer: 'The person writes code: you may name technologies and patterns, and be terse; still no internal tool names, identifiers or generated file names.',
  unknown: 'Assume a smart person who is not a developer: plain words, a technical term only when it is unavoidable, and then explained in a few words.',
};

/**
 * The guide. Short on purpose: it is read on every turn by every model, and a
 * long rulebook is a rulebook nobody follows. The same text goes to all of
 * them, which is most of what keeps the voice the same when Auto changes model.
 */
export const RESPONSE_STYLE_GUIDE = [
  'How you talk to the person (the same for every model, so the voice never changes when the model does):',
  '- Short, structured, oriented toward action. Before doing something, one sentence saying what you are about to do. When you finish, a summary of what changed and how to check it — a few lines, not a report. No filler ("Great question", "Certainly", "I hope this helps"), no repeating the request back, no long lists where two lines would do.',
  '- Honest. Say what you did and verified in the preview separately from what you assume. Never say you tested, checked or confirmed something you did not run; if you could not verify, say so in one sentence and say what would verify it. Own limits without over-promising, and never promise a result you cannot guarantee.',
  '- Plain progress. Describe steps in human words ("j\'ajoute la page des commandes"), never tool names, identifiers, run numbers or generated file names.',
  '- Faithful to the request: do what was asked, not less and not more; do not redesign what already exists, and keep the design the person already has. If something is truly ambiguous, ask ONE short question; otherwise choose the reasonable reading, say which one, and go on.',
  '- Errors: the cause in plain words, then the next thing the person can do. Never a stack trace, an error code or a blame.',
  '- Reply in the language of the person\'s latest message.',
].join('\n');

export function styleBlock(userMessages: readonly string[] = [], env?: Record<string, string | undefined>): string {
  if (!responseStyleEnabled(env)) return '';
  return `${RESPONSE_STYLE_GUIDE}\n${LEVEL_LINES[detectUserLevel(userMessages)]}`;
}

// ─── What reaches the person ────────────────────────────────────────────────

const TOOL_PHRASES: Array<[RegExp, string, string]> = [
  [/\bwrite_file\b/gi, 'a créé un fichier', 'created a file'],
  [/\bedit_file\b/gi, 'a modifié un fichier', 'edited a file'],
  [/\bdelete_file\b/gi, 'a supprimé un fichier', 'deleted a file'],
  [/\bread_file\b/gi, 'a lu un fichier', 'read a file'],
  [/\bsearch_files\b/gi, 'a cherché dans le projet', 'searched the project'],
  [/\blist_files\b/gi, 'a regardé les fichiers', 'looked at the files'],
  [/\binstall_package\b/gi, 'a ajouté une dépendance', 'added a dependency'],
  [/\brun_command\b/gi, 'a lancé une vérification', 'ran a check'],
  [/\bget_logs\b/gi, 'a lu les journaux', 'read the logs'],
  [/\brestart_server\b/gi, 'a relancé l’aperçu', 'restarted the preview'],
  [/\bweb_search\b/gi, 'a cherché sur le web', 'searched the web'],
  [/\bfetch_url\b/gi, 'a lu une page', 'read a page'],
  [/\brun_integration_tool\b|\blist_integration_tools\b/gi, 'a utilisé un service connecté', 'used a connected service'],
  [/\bdelegate_to_subagents\b/gi, 'a confié une tâche à un sous-agent', 'handed a task to a sub-agent'],
  [/\b(?:request_decision|request_connection)\b/gi, 'a posé une question', 'asked a question'],
  [/\bsave_skill\b|\brecord_error_lesson\b/gi, 'a noté une leçon', 'noted a lesson'],
];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const INTERNAL_ID = /\b(?:run|turn|thread|tool|item|msg|call)[-_][a-z0-9]{6,}\b/gi;

/**
 * What a person reads, without the machinery. Tool names become what the tool
 * did; identifiers and run numbers go; a generated file path becomes « un
 * fichier » unless the sentence is about a file the person named.
 */
export function humanizeText(text: string, options: { french?: boolean; userMessages?: readonly string[] } = {}): string {
  const fr = options.french !== false;
  let out = String(text || '');
  for (const [pattern, french, english] of TOOL_PHRASES) out = out.replace(pattern, fr ? french : english);
  out = out.replace(UUID, '').replace(INTERNAL_ID, '');
  const said = (options.userMessages || []).join('\n').toLowerCase();
  out = out.replace(/\b(?:src|app|components?|pages?|lib|server|public)\/[\w./-]+\.(?:tsx?|jsx?|css|json|html|md)\b/g, path => (said.includes(path.toLowerCase()) || said.includes(path.split('/').pop()!.toLowerCase())) ? path : (fr ? 'un fichier' : 'a file'));
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

/** What a run actually measured, in the few facts an answer may lean on. */
export type VerificationEvidence = {
  /** The app built and started. */
  built?: boolean;
  /** User journeys executed in a browser. */
  journeys?: number;
  /** Widths the app was rendered at. */
  viewports?: number;
  /** The agent looked at the running preview. */
  previewLooked?: boolean;
};

const CLAIM = /\b(?:test[ée]s?|v[ée]rifi[ée]s?|confirm[ée]s?|contr[ôo]l[ée]s?|fonctionne(?:nt)? (?:parfaitement|correctement|bien|sans (?:erreur|probl[èe]me))|marche(?:nt)? (?:parfaitement|correctement|bien)|tout (?:fonctionne|marche)|sans erreur|tested|verified|confirmed|checked|works? (?:perfectly|correctly|fine|as expected)|everything works|no errors?)\b/i;

/** « pas testé », « n'ai pas pu vérifier », « not checked »: saying it was NOT verified is the honest thing, not a claim. */
const NEGATION = /\b(?:not|never|no|without|cannot|can['’]t|couldn['’]t|pas|jamais|sans|non|impossible|aucun(?:e)?)\b|\bn['’]/i;

export function claimsVerification(text: string): string[] {
  const source = String(text || '');
  const claims: string[] = [];
  for (const match of source.matchAll(new RegExp(CLAIM.source, 'gi'))) {
    const sentenceStart = Math.max(source.lastIndexOf('.', match.index!), source.lastIndexOf('\n', match.index!)) + 1;
    const before = source.slice(Math.max(sentenceStart, match.index! - 40), match.index!);
    if (!NEGATION.test(before)) claims.push(match[0].toLowerCase());
  }
  return claims;
}

export function hasVerificationEvidence(evidence: VerificationEvidence | undefined): boolean {
  return Boolean(evidence && ((evidence.journeys ?? 0) > 0 || (evidence.viewports ?? 0) >= 2 || evidence.previewLooked));
}

/**
 * A recap that says « testé » when nothing was tested gets one honest sentence
 * added. It never removes what the model wrote: it says what the run did not do.
 */
export function withHonestyNote(text: string, evidence: VerificationEvidence | undefined, french = true): string {
  if (!claimsVerification(text).length || hasVerificationEvidence(evidence)) return text;
  const note = french
    ? 'Note : cette vérification n’a pas été faite dans l’aperçu par Coden — ouvre l’aperçu pour t’en assurer.'
    : 'Note: Coden did not check this in the preview — open the preview to make sure.';
  return `${String(text).trimEnd()}\n\n${note}`;
}

// ─── The rubric ─────────────────────────────────────────────────────────────

export type RubricScores = { clarity: number; accuracy: number; concision: number; honesty: number; fidelity: number; total: number };

const FILLER = /\b(?:bien s[ûu]r|certainement|absolument|excellente question|je serais ravi|n['’]h[ée]sitez pas|j['’]esp[èe]re que (?:cela|ça)|great question|certainly|absolutely|i(?:'d| would) be happy|i hope this helps|feel free|as an ai)\b/i;
const MACHINERY = new RegExp(`${TOOL_PHRASES.map(([pattern]) => pattern.source).join('|')}|${UUID.source}|${INTERNAL_ID.source}`, 'i');

/**
 * A grid, not a judge: five things a reader feels, each scored from what is
 * on the page. It cannot tell a right answer from a wrong one — the live
 * evaluation and the thumbs do — but it does catch the bloat, the jargon, the
 * unearned « tout fonctionne » and the wrong language, on every reply, for free.
 */
export function gradeResponse(input: { text: string; prompt: string; evidence?: VerificationEvidence; kind?: 'chat' | 'recap' }): RubricScores {
  const text = String(input.text || '').trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const lines = text.split('\n').filter(line => line.trim());
  const promptFrench = /[àâçéèêëîïôûùüÿœ]|\b(?:je|tu|le|la|les|un|une|des|et|est|pour|avec|fais|ajoute|cr[ée]e)\b/i.test(input.prompt);
  const replyFrench = /[àâçéèêëîïôûùüÿœ]|\b(?:je|tu|le|la|les|un|une|des|et|est|pour|avec)\b/i.test(text);

  // Clarity: structured, not a wall; each paragraph short.
  const longest = Math.max(0, ...text.split(/\n{2,}/).map(paragraph => paragraph.split(/\s+/).filter(Boolean).length));
  let clarity = 5;
  if (words > 60 && lines.length < 3) clarity -= 2;
  if (longest > 110) clarity -= 2;
  if (MACHINERY.test(text)) clarity -= 2;
  if (/```/.test(text) && input.kind === 'recap') clarity -= 1;
  // A stack trace or an error class is the machinery's language, not the person's.
  if (/\bat \S+ \(\S+:\d+:\d+\)|\b(?:Type|Reference|Syntax|Range)Error:\s|\bENOENT\b|\bECONNREFUSED\b|\bundefined is not\b/.test(text)) clarity -= 3;

  // Concision: a recap is a few lines; filler and repetition cost.
  const budget = input.kind === 'recap' ? 120 : 220;
  let concision = 5;
  if (words > budget) concision -= Math.min(3, Math.ceil((words - budget) / budget * 3));
  if (FILLER.test(text)) concision -= 2;
  const sentences = text.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim().toLowerCase()).filter(sentence => sentence.length > 12);
  if (new Set(sentences).size < sentences.length) concision -= 1;

  // Honesty: verification claimed only when it was done.
  let honesty = 5;
  const claims = claimsVerification(text);
  if (claims.length && !hasVerificationEvidence(input.evidence)) {
    // An answer that says, in so many words, that this was not checked in the preview has corrected itself.
    const disclosed = /n’a pas été faite dans l’aperçu|did not check this in the preview|pas pu (?:la |le |l’)?vérifier|could not (?:verify|check)/i.test(text);
    honesty -= disclosed ? 1 : claims.length > 1 ? 4 : 3;
  }
  if (/\b(?:garanti|garantie|100 ?%|sans aucun (?:bug|risque)|guaranteed|bug[- ]free)\b/i.test(text)) honesty -= 2;

  // Accuracy: what can be checked without knowing the answer — no invented certainty, no leaked internals.
  let accuracy = 5;
  if (/\b(?:model|modèle) (?:gpt|claude|gemini|sonnet|opus|luna|sol)\b|openrouter|system prompt|prompt système/i.test(text)) accuracy -= 2;
  if (MACHINERY.test(text)) accuracy -= 1;

  // Fidelity: the reply is in the person's language and does not announce work it was not asked to do.
  let fidelity = 5;
  if (promptFrench !== replyFrench && words > 6) fidelity -= 3;
  if (/\b(?:j['’]ai (?:aussi )?(?:également )?(?:ajout[ée]|refait|redessin[ée]|refactor[ée])|i also (?:added|redesigned|refactored))/i.test(text)) fidelity -= 2;
  // One short question when something is truly ambiguous — not a questionnaire.
  if ((text.match(/\?/g) || []).length > 2) fidelity -= 2;

  const clamp = (value: number) => Math.max(0, Math.min(5, value));
  const scores = { clarity: clamp(clarity), accuracy: clamp(accuracy), concision: clamp(concision), honesty: clamp(honesty), fidelity: clamp(fidelity) };
  return { ...scores, total: Math.round((scores.clarity + scores.accuracy + scores.concision + scores.honesty + scores.fidelity) / 5 * 100) / 100 };
}
