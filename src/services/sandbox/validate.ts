/**
 * Deciding whether a generated project actually works.
 *
 * The old answer was a static analysis of the source: it could tell you a file
 * looked like React, and could not tell you the project failed to compile.
 * This asks the project's own toolchain instead, in the order that fails
 * fastest and most informatively:
 *
 *   dev server up   -- if it will not start, nothing below it matters
 *   runtime logs    -- an import that does not resolve says so here first
 *   typecheck       -- names files and lines, which is what a repair needs
 *   build           -- the only check that matches what publishing will do
 *
 * The output is a list of problems with file paths attached, because a repair
 * prompt that says "fix the errors" costs a full regeneration while one that
 * says "src/App.tsx line 12 cannot find './Header'" costs one file.
 */

import type { ProjectSandbox } from './project-sandbox.ts';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationProblem = {
  source: 'dev_server' | 'typecheck' | 'build' | 'runtime';
  severity: ValidationSeverity;
  message: string;
  file?: string;
  line?: number;
  /** A package that is imported but not installed, when we can name it. */
  missingPackage?: string;
};

export type ValidationReport = {
  ok: boolean;
  problems: ValidationProblem[];
  ran: { devServer: boolean; typecheck: boolean; build: boolean; browser?: boolean };
  durationMs: number;
};

/** `src/App.tsx(12,5): error TS2307: Cannot find module './Header'.` */
const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s*error\s+TS\d+:\s*(.+)$/;

/** Vite and Node both name the specifier they could not resolve. */
const MISSING_MODULE = [
  /Failed to resolve import "([^"]+)"/,
  /Cannot find module ['"]([^'"]+)['"]/,
  /Could not resolve ['"]([^'"]+)['"]/,
  /ERR_MODULE_NOT_FOUND.*?['"]([^'"]+)['"]/,
];

/**
 * Where a bundler says the problem is.
 *
 * Two shapes, because Vite uses both and the more useful one carries no line
 * number: `File: /abs/path/src/App.tsx:12:0` in a stack frame, and
 * `Failed to resolve import "x" from "src/App.tsx"` in the message itself.
 * Matching only the first drops the file from the exact error that names the
 * missing dependency — the one a repair most needs located.
 */
const VITE_FILE_WITH_LINE = /((?:src|app|pages|components)\/[\w./-]+\.[jt]sx?):(\d+)(?::\d+)?/;
const VITE_FILE_QUOTED = /from ["']([^"']+\.[jt]sx?)["']/;

/**
 * The package a failed import refers to, if it is one.
 *
 * A relative specifier is a missing file, which is the model's problem to fix
 * by writing it. A bare specifier is a missing dependency, which is an install
 * — a different repair, so telling them apart matters.
 */
export function packageFromSpecifier(specifier: string): string | null {
  const value = String(specifier || '').trim();
  if (!value || value.startsWith('.') || value.startsWith('/') || value.startsWith('@/')) return null;
  if (/^(?:node:|https?:)/.test(value)) return null;
  const parts = value.split('/');
  return value.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Read compiler output into problems a repair can act on. */
export function parseTypecheckOutput(output: string): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = TSC_LINE.exec(line.trim());
    if (!match) continue;
    const message = match[4];
    const specifier = MISSING_MODULE.map(pattern => pattern.exec(message)?.[1]).find(Boolean);
    problems.push({
      source: 'typecheck',
      severity: 'error',
      file: match[1].replace(/\\/g, '/'),
      line: Number(match[2]),
      message,
      ...(specifier ? { missingPackage: packageFromSpecifier(specifier) || undefined } : {}),
    });
  }
  return problems;
}

/** Read dev server / build output into the same shape. */
export function parseRuntimeOutput(output: string, source: 'dev_server' | 'build' | 'runtime'): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const seen = new Set<string>();
  for (const line of String(output || '').split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    const specifier = MISSING_MODULE.map(pattern => pattern.exec(text)?.[1]).find(Boolean);
    const isError = specifier || /\b(?:error|failed|cannot|unexpected|is not defined|SyntaxError|TypeError)\b/i.test(text);
    if (!isError) continue;
    // The same unresolved import is reported by the plugin, the transform and
    // the overlay; three rows saying it once each is a worse repair prompt.
    const key = specifier || text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    const located = VITE_FILE_WITH_LINE.exec(text);
    // A quoted path has no line, which is still far better than no file.
    const quoted = located ? null : VITE_FILE_QUOTED.exec(text)?.[1]?.replace(/^\.?\//, '');
    problems.push({
      source,
      severity: 'error',
      message: text.slice(0, 400),
      ...(located ? { file: located[1], line: Number(located[2]) } : quoted ? { file: quoted } : {}),
      ...(specifier ? { missingPackage: packageFromSpecifier(specifier) || undefined } : {}),
    });
  }
  return problems;
}

/**
 * Run the project's own checks.
 *
 * Stops at the first stage that fails: a project whose dev server will not
 * start has nothing useful to say about its build, and running it anyway
 * buries the one error that matters under a hundred that follow from it.
 */
export async function validateProject(
  sandbox: ProjectSandbox,
  options: { typecheckTimeoutMs?: number; buildTimeoutMs?: number; skipBuild?: boolean } = {},
): Promise<ValidationReport> {
  const startedAt = Date.now();
  const ran = { devServer: false, typecheck: false, build: false };
  const problems: ValidationProblem[] = [];
  const done = (): ValidationReport => ({
    ok: problems.every(problem => problem.severity !== 'error'),
    problems,
    ran,
    durationMs: Date.now() - startedAt,
  });

  const status = sandbox.status();
  // An idle sandbox is one nobody asked to run, which is not a failure of the
  // project. A crashed one is: somebody asked, and it did not come up.
  if (status.state !== 'idle') {
    ran.devServer = true;
    if (status.state !== 'running') {
      problems.push({
        source: 'dev_server',
        severity: 'error',
        message: status.lastError || 'The dev server is not running.',
      });
    }
    // What the server has already complained about. An unresolved import
    // surfaces here before any check runs, which makes it the cheapest signal
    // available and often the only one that names the real cause.
    problems.push(...parseRuntimeOutput(
      sandbox.getLogs(150).filter(entry => status.state !== 'running' || !entry.at || entry.at >= startedAt).map(entry => entry.line).join('\n'),
      status.state === 'running' ? 'runtime' : 'dev_server',
    ));
  }

  // The checks run whether or not a server is up. A project whose server did
  // not start is exactly the case where the compiler's file-and-line output is
  // most needed, so stopping here would withhold the best evidence at the
  // moment it matters most.

  let hasTypecheck = false;
  if (await sandbox.hasFile('package.json')) {
    try {
      const pkg = JSON.parse(await sandbox.readProjectFile('package.json'));
      hasTypecheck = typeof pkg.scripts?.typecheck === 'string' && !!pkg.scripts.typecheck.trim();
    } catch {
      problems.push({ source:'typecheck',severity:'error',message:'package.json could not be parsed.' });
      return done();
    }
  }
  if (hasTypecheck) {
    const typecheck = await sandbox.runCommand('npm', ['run', 'typecheck'], {
      timeoutMs: options.typecheckTimeoutMs ?? 120_000,
    }).catch(() => ({ code: -1, output: 'The typecheck process could not be started or timed out.' }));
    if (typecheck) {
      ran.typecheck = true;
      if (typecheck.code !== 0) {
        const parsed = parseTypecheckOutput(typecheck.output);
        problems.push(...(parsed.length ? parsed : [{
          source: 'typecheck' as const,
          severity: 'error' as const,
          message: typecheck.output.slice(-1_500) || 'The typecheck failed without output.',
        }]));
        // A project that does not typecheck will not build either, and its
        // build errors are the same ones with less location detail.
        return done();
      }
    }
  }

  if (!options.skipBuild) {
    const build = await sandbox.runCommand('npm', ['run', 'build'], {
      timeoutMs: options.buildTimeoutMs ?? 180_000,
    }).catch(() => ({ code: -1, output: 'The build process could not be started or timed out.' }));
    if (build) {
      ran.build = true;
      if (build.code !== 0) {
        const parsed = parseRuntimeOutput(build.output, 'build');
        problems.push(...(parsed.length ? parsed : [{
          source: 'build' as const,
          severity: 'error' as const,
          message: build.output.slice(-1_500) || 'The build failed without output.',
        }]));
      }
    }
  }

  return done();
}

/**
 * The report as a repair instruction.
 *
 * Written as facts and locations, never as advice: the model is better at
 * fixing an error it can see than at following a suggestion about one. The
 * files are listed separately because naming them is what keeps a repair from
 * turning into a regeneration.
 */
export function buildRepairInstruction(report: ValidationReport, maxProblems = 12): string {
  const errors = report.problems.filter(problem => problem.severity === 'error').slice(0, maxProblems);
  if (!errors.length) return '';

  const packages = [...new Set(errors.map(problem => problem.missingPackage).filter(Boolean))] as string[];
  const files = [...new Set(errors.map(problem => problem.file).filter(Boolean))] as string[];

  const lines = ['The application does not run. These are its own toolchain’s errors:'];
  for (const problem of errors) {
    const where = problem.file ? `${problem.file}${problem.line ? `:${problem.line}` : ''}` : problem.source;
    lines.push(`- [${problem.source}] ${where} — ${problem.message}`);
  }
  if (packages.length) {
    lines.push('', `Missing dependencies: ${packages.join(', ')}. Install them rather than rewriting the imports.`);
  }
  if (files.length) {
    lines.push('', `Change only these files: ${files.join(', ')}. Leave everything else exactly as it is.`);
  }
  return lines.join('\n');
}
