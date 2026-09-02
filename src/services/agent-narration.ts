/**
 * User-facing narration for a running turn.
 *
 * Two rules the shimmer kept breaking. First, the core contract forbids
 * exposing internal mechanics — model names, routing, fallbacks — so a
 * narration line may never mention them. Second, verification checks carry
 * developer-facing English messages ("AI provider keys must be read in the
 * server connector, not frontend files"), and dumping one into the shimmer
 * shows a non-technical user a rule they never wrote, in the wrong language.
 *
 * What is safe and useful is the concrete artefact being worked on: the file.
 * It is already visible in the file list, it needs no translation, and it tells
 * the user where the work is happening.
 */

export type NarrationLanguage = 'fr' | 'en';

export type NarrationIssue = {
  file?: string | null;
  message?: string | null;
  key?: string | null;
};

/** A path the user can recognise, or null when there is nothing concrete. */
function readableFile(issue: NarrationIssue | undefined): string | null {
  const file = String(issue?.file || '').trim();
  if (!file || file === 'runtime' || file === 'unknown') return null;
  return file;
}

/**
 * The line shown while Coden repairs something.
 *
 * Names the file when one is known, and otherwise stays deliberately general —
 * never the internal check message.
 */
export function repairNarration(issues: NarrationIssue[], language: NarrationLanguage): string {
  const file = readableFile(issues?.[0]);
  const remaining = Math.max(0, (issues?.length || 0) - 1);
  if (language === 'fr') {
    if (file && remaining) return `Coden corrige ${file} et ${remaining} autre${remaining > 1 ? 's' : ''} point${remaining > 1 ? 's' : ''}…`;
    if (file) return `Coden corrige ${file}…`;
    return 'Coden corrige les problèmes détectés…';
  }
  if (file && remaining) return `Coden is fixing ${file} and ${remaining} more issue${remaining > 1 ? 's' : ''}…`;
  if (file) return `Coden is fixing ${file}…`;
  return 'Coden is fixing the detected issues…';
}

/** The line shown while a generated file is being written. */
export function writingFileNarration(path: string, language: NarrationLanguage): string {
  const safe = String(path || '').trim();
  if (!safe) return language === 'fr' ? 'Coden construit l’application…' : 'Coden is building the application…';
  return language === 'fr' ? `Coden écrit ${safe}…` : `Coden is writing ${safe}…`;
}
