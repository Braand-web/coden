/**
 * Smart Context Injector — Intelligent file selection for LLM context windows.
 *
 * Replaces the naive "first 18 files by sort order" strategy with a
 * relevance-ranked approach that:
 * 1. Always includes critical entry-point files
 * 2. Scores each file by keyword relevance to the current prompt
 * 3. Follows import dependencies of relevant files
 * 4. Respects a hard token budget to avoid context overflow
 * 5. Summarizes excluded files so the LLM still knows they exist
 *
 * Zero external dependencies — pure TypeScript.
 */

export type ScoredFile = {
  path: string;
  content: string;
  language?: string;
  relevanceScore: number;
  reason: string;
};

export type InjectionResult = {
  contextText: string;
  includedFiles: string[];
  excludedFiles: string[];
  tokenEstimate: number;
  compressionRatio: number;
};

// Files that are always critical regardless of prompt
const ALWAYS_CRITICAL_PATTERNS = [
  /^package\.json$/i,
  /^index\.html$/i,
  /^vite\.config\./i,
  /^src\/main\.(t|j)sx?$/i,
  /^src\/App\.(t|j)sx?$/i,
  /^supabase\/schema\.sql$/i,
  /^src\/lib\/(supabase|codenCloud|api|auth|appData)\./i,
];

// File categories with base relevance scores
const FILE_CATEGORY_SCORES: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /^src\/App\.(t|j)sx?$/, score: 90 },
  { pattern: /^src\/main\.(t|j)sx?$/, score: 85 },
  { pattern: /^index\.html$/, score: 80 },
  { pattern: /^package\.json$/, score: 75 },
  { pattern: /^src\/lib\//, score: 70 },
  { pattern: /^src\/components\//, score: 60 },
  { pattern: /^src\/hooks\//, score: 55 },
  { pattern: /^src\/pages\//, score: 55 },
  { pattern: /^src\/services\//, score: 50 },
  { pattern: /^supabase\//, score: 65 },
  { pattern: /\.(css|scss)$/, score: 40 },
  { pattern: /\.(test|spec)\.(t|j)sx?$/, score: 20 },
];

/**
 * Keyword groups — each prompt signal boosts relevance of matching files.
 */
const KEYWORD_BOOSTS: Array<{ keywords: RegExp; filePatterns: RegExp; boost: number }> = [
  // Auth changes → boost auth files
  { keywords: /\b(auth|login|signup|session|oauth|role|permission)\b/i, filePatterns: /auth|login|session|supabase/i, boost: 40 },
  // Billing → boost billing files
  { keywords: /\b(billing|stripe|payment|checkout|subscription|credits?)\b/i, filePatterns: /billing|stripe|payment|subscription/i, boost: 40 },
  // Database → boost schema and lib files
  { keywords: /\b(database|supabase|sql|schema|table|rls|crud|migration)\b/i, filePatterns: /schema|supabase|db|database/i, boost: 40 },
  // Design/UI → boost component and CSS files
  { keywords: /\b(design|ui|ux|layout|style|color|spacing|animation|responsive|mobile)\b/i, filePatterns: /component|style|css|App\./i, boost: 30 },
  // API → boost API and server files
  { keywords: /\b(api|endpoint|route|backend|server|webhook|edge function)\b/i, filePatterns: /api|route|server|endpoint|edge/i, boost: 35 },
  // Dashboard → boost dashboard and analytics files
  { keywords: /\b(dashboard|analytics|chart|metric|report|kpi)\b/i, filePatterns: /dashboard|analytics|chart|metric/i, boost: 30 },
  // Config/deploy → boost config files
  { keywords: /\b(deploy|publish|vercel|railway|domain|build|vite|config)\b/i, filePatterns: /vite|config|deploy|vercel/i, boost: 35 },
];

function estimateTokens(text: string): number {
  // Roughly 4 chars per token for code
  return Math.ceil(text.length / 4);
}

function isAlwaysCritical(path: string): boolean {
  return ALWAYS_CRITICAL_PATTERNS.some(p => p.test(path));
}

function baseCategoryScore(path: string): number {
  for (const { pattern, score } of FILE_CATEGORY_SCORES) {
    if (pattern.test(path)) return score;
  }
  return 30; // default for unknown files
}

/**
 * Extracts local relative imports from a file's content.
 */
function extractLocalImports(content: string, fromPath: string): string[] {
  const dir = fromPath.split('/').slice(0, -1).join('/');
  const imports: string[] = [];
  const regex = /(?:import|from)\s+['"](\.[^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const specifier = match[1];
    // Resolve relative path
    const parts = `${dir}/${specifier}`.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '..') resolved.pop();
      else if (part !== '.') resolved.push(part);
    }
    imports.push(resolved.join('/'));
  }
  return imports;
}

/**
 * Main entry point — selects the most relevant files for the current prompt
 * and returns formatted context text + metadata.
 */
export function buildSmartContextInjection(
  files: Array<{ path: string; content: string; language?: string }>,
  prompt: string,
  options: {
    tokenBudget?: number;  // max tokens to spend on file context (default 80_000)
    maxFiles?: number;     // hard file count limit (default 25)
    alwaysFullContent?: boolean; // skip truncation for small projects
  } = {},
): InjectionResult {
  const tokenBudget = options.tokenBudget ?? 80_000;
  const maxFiles = options.maxFiles ?? 25;

  if (!files.length) {
    return {
      contextText: 'No existing files yet.',
      includedFiles: [],
      excludedFiles: [],
      tokenEstimate: 0,
      compressionRatio: 1,
    };
  }

  const promptLower = prompt.toLowerCase();

  // Step 1: Score each file
  const scored: ScoredFile[] = files.map(file => {
    let score = baseCategoryScore(file.path);
    const reasons: string[] = [];

    // Critical files always get max score
    if (isAlwaysCritical(file.path)) {
      score = 100;
      reasons.push('critical_entry_point');
    }

    // Apply keyword boosts based on prompt
    for (const { keywords, filePatterns, boost } of KEYWORD_BOOSTS) {
      if (keywords.test(promptLower) && filePatterns.test(file.path)) {
        score += boost;
        reasons.push(`keyword_boost:${boost}`);
      }
    }

    // Boost recently modified files (if path contains timestamps — heuristic)
    const contentLen = (file.content || '').length;
    if (contentLen > 5000) score += 5; // non-trivial files are more likely relevant
    if (contentLen < 100) score -= 20; // near-empty files rarely matter

    // Exact filename match to prompt keywords
    const filename = file.path.split('/').pop() || '';
    if (promptLower.includes(filename.replace(/\.[^.]+$/, '').toLowerCase())) {
      score += 25;
      reasons.push('filename_match');
    }

    return {
      ...file,
      relevanceScore: Math.min(150, score),
      reason: reasons.join(', ') || 'base_score',
    };
  });

  // Step 2: Sort by relevance descending
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Step 3: Include top files respecting budget and import graph expansion
  const included: ScoredFile[] = [];
  const includedPaths = new Set<string>();
  let usedTokens = 0;

  // First pass: always include critical files
  for (const file of scored) {
    if (isAlwaysCritical(file.path) && !includedPaths.has(file.path)) {
      const tokens = estimateTokens(file.content || '');
      if (usedTokens + tokens <= tokenBudget) {
        included.push(file);
        includedPaths.add(file.path);
        usedTokens += tokens;
      }
    }
  }

  // Second pass: fill budget with highest-scored remaining files
  for (const file of scored) {
    if (includedPaths.has(file.path)) continue;
    if (included.length >= maxFiles) break;

    const content = file.content || '';
    let tokens = estimateTokens(content);

    // If file is too large and we're not in alwaysFullContent mode, truncate smartly
    const maxFileTokens = Math.floor(tokenBudget * 0.25); // single file cap at 25% of budget
    let truncated = content;
    if (!options.alwaysFullContent && tokens > maxFileTokens) {
      const charLimit = maxFileTokens * 4;
      truncated = content.slice(0, charLimit) + '\n// ...[smart-truncated: file continues]';
      tokens = estimateTokens(truncated);
    }

    if (usedTokens + tokens > tokenBudget) continue;

    included.push({ ...file, content: truncated });
    includedPaths.add(file.path);
    usedTokens += tokens;

    // Step 4: Follow local imports of included files (one level deep)
    if (included.length < maxFiles) {
      const imports = extractLocalImports(content, file.path);
      for (const importPath of imports) {
        if (includedPaths.has(importPath)) continue;
        const dep = files.find(f =>
          f.path === importPath ||
          f.path === `${importPath}.ts` ||
          f.path === `${importPath}.tsx` ||
          f.path === `${importPath}/index.ts` ||
          f.path === `${importPath}/index.tsx`,
        );
        if (dep && !includedPaths.has(dep.path)) {
          const depTokens = estimateTokens(dep.content || '');
          if (usedTokens + depTokens <= tokenBudget && included.length < maxFiles) {
            included.push({ ...dep, relevanceScore: file.relevanceScore - 5, reason: `imported_by:${file.path}` });
            includedPaths.add(dep.path);
            usedTokens += depTokens;
          }
        }
      }
    }
  }

  const excluded = files.filter(f => !includedPaths.has(f.path));

  // Step 5: Build context text
  const chunks: string[] = [];

  for (const file of included) {
    const header = `--- ${file.path} (${file.language || inferLang(file.path)}) ---`;
    chunks.push(`${header}\n${file.content || ''}`);
  }

  // Add a concise manifest of excluded files so LLM knows they exist
  if (excluded.length > 0) {
    const manifest = excluded
      .slice(0, 30)
      .map(f => `  ${f.path} (${Math.ceil((f.content || '').length / 4)} tokens)`)
      .join('\n');
    chunks.push(
      `--- EXCLUDED FILES (not injected to save context) ---\n` +
      `${excluded.length} additional files exist but were omitted to stay within context limits:\n${manifest}` +
      (excluded.length > 30 ? `\n  ...and ${excluded.length - 30} more` : ''),
    );
  }

  const contextText = chunks.join('\n\n');

  return {
    contextText,
    includedFiles: included.map(f => f.path),
    excludedFiles: excluded.map(f => f.path),
    tokenEstimate: usedTokens,
    compressionRatio: files.length > 0 ? included.length / files.length : 1,
  };
}

function inferLang(path: string): string {
  if (/\.tsx?$/.test(path)) return 'typescript';
  if (/\.jsx?$/.test(path)) return 'javascript';
  if (/\.css$/.test(path)) return 'css';
  if (/\.html$/.test(path)) return 'html';
  if (/\.sql$/.test(path)) return 'sql';
  if (/\.json$/.test(path)) return 'json';
  if (/\.md$/.test(path)) return 'markdown';
  return 'text';
}
