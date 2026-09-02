/**
 * Turning a failed run into a repair the model can aim at.
 *
 * When verification failed, the server sent the whole project back with a list
 * of blocker messages and asked for a repair. That is a second full generation:
 * on the QuickCalc run it took from 06:03 to 06:08 and then timed out, and the
 * user was told "the AI provider did not answer in time" for what was really a
 * repair pass rewriting an entire application to fix a compiler error.
 *
 * The runner already captures the build, lint and test output; it was simply
 * never read. `parseBuildErrors` already turns that output into file-scoped
 * diagnostics; it was never called. This joins the two, so a repair can name
 * the files that actually failed and the lines that failed in them.
 *
 * When no compiler diagnostic can be extracted, this reports so rather than
 * inventing a target — the caller keeps its existing broad repair, which is the
 * right fallback for a blocker that is not a build error at all.
 */

import { hasBlockingErrors, parseBuildErrors, type BuildDiagnostic } from './build-error-autofix.ts';

export type RepairCheck = {
  check_type?: string;
  status?: string;
  message?: string;
  public_payload?: Record<string, unknown> | null;
};

export type TargetedRepair = {
  /** True when compiler output named at least one file we can aim at. */
  targeted: boolean;
  /** The files the diagnostics blame, most-cited first. */
  files: string[];
  diagnostics: BuildDiagnostic[];
  /** The instruction block to add to the repair prompt. */
  instruction: string;
};

const EMPTY: TargetedRepair = { targeted: false, files: [], diagnostics: [], instruction: '' };

/** The captured output of every script the runner actually failed. */
export function failedRunnerOutput(checks: RepairCheck[] | null | undefined): string {
  return (checks || [])
    .filter(check => String(check?.status) === 'failed' && /^script_.*_exec$/.test(String(check?.check_type || '')))
    .map(check => String((check?.public_payload as any)?.output || ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Read the build output into a repair aimed at the files that failed.
 *
 * Files are ordered by how often the compiler blamed them, so the first name in
 * the prompt is the one the errors actually cluster in rather than whichever
 * happened to be reported first.
 */
export function buildTargetedRepair(checks: RepairCheck[] | null | undefined, maxFiles = 6): TargetedRepair {
  const output = failedRunnerOutput(checks);
  if (!output.trim()) return EMPTY;

  const diagnostics = parseBuildErrors(output);
  if (!diagnostics.length || !hasBlockingErrors(diagnostics)) return EMPTY;

  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    const file = String(diagnostic.file || '').trim();
    if (!file || file === 'unknown') continue;
    counts.set(file, (counts.get(file) || 0) + 1);
  }
  const files = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFiles)
    .map(([file]) => file);

  if (!files.length) return EMPTY;

  const lines = diagnostics
    .filter(diagnostic => files.includes(String(diagnostic.file || '')))
    .slice(0, 20)
    .map(diagnostic => {
      const where = diagnostic.line ? `${diagnostic.file}:${diagnostic.line}` : String(diagnostic.file);
      const code = diagnostic.code ? ` [${diagnostic.code}]` : '';
      return `- ${where}${code} ${diagnostic.message}`;
    });

  const instruction = [
    `The build failed in ${files.length} file${files.length > 1 ? 's' : ''}. Change only ${files.join(', ')}.`,
    'Return every other file unchanged. Fix these exact errors:',
    ...lines,
  ].join('\n');

  return { targeted: true, files, diagnostics, instruction };
}
