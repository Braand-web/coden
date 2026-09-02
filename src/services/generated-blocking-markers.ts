/**
 * Markers that make a generated file unusable, and the repair that removes them.
 *
 * Detection and repair must come from this one module. When the preview refused
 * a marker that no repair pass could remove, the project sat in `needs_fix`
 * forever: every retry re-detected it, every fix left it in place, and
 * publishing stayed blocked for good. `strippedOfBlockingMarkers` is therefore
 * required to clear everything `hasBlockingGeneratedImport` reports.
 */

/** Import specifiers a generated app must never ship. */
export const GENERATED_BLOCKING_IMPORT_SPECIFIER = /__missing_import__|missing-module/i;

/**
 * The whole import statement, matched before the bare `from` clause below —
 * stripping only the clause leaves a dangling `import { Thing }` and the file
 * stops parsing, turning a reported problem into a real syntax error.
 */
const BLOCKING_IMPORT_STATEMENT = /import\s+[^;\n]*from\s+['"][^'"]*(?:__missing_import__|missing-module)[^'"]*['"];?[ \t]*\n?/gi;
const BLOCKING_IMPORT_CLAUSE = /from\s+['"][^'"]*(?:__missing_import__|missing-module)[^'"]*['"];?/gi;

const FORCED_ERROR_STATEMENT = /^\s*throw\s+new\s+Error\(\s*['"`]__CODEN_FORCE_ERROR__['"`]\s*\);\s*$/gim;
const FORCED_ERROR_CALL = /throw\s+new\s+Error\(\s*['"`]__CODEN_FORCE_ERROR__['"`]\s*\);?/gi;
const FORCED_ERROR_MARKER = /__CODEN_FORCE_ERROR__/gi;

/** True when the file imports from a specifier the preview refuses. */
export function hasBlockingGeneratedImport(content: string): boolean {
  const source = String(content || '');
  return /from\s+['"][^'"]+['"]/.test(source) && GENERATED_BLOCKING_IMPORT_SPECIFIER.test(source);
}

/** Remove every blocking marker, leaving the rest of the file untouched. */
export function strippedOfBlockingMarkers(content: string): string {
  return String(content || '')
    .replace(FORCED_ERROR_STATEMENT, '')
    .replace(FORCED_ERROR_CALL, '')
    .replace(FORCED_ERROR_MARKER, '')
    .replace(BLOCKING_IMPORT_STATEMENT, '')
    .replace(BLOCKING_IMPORT_CLAUSE, '');
}
