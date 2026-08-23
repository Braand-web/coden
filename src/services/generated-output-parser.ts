export class GeneratedOutputParseError extends Error {
  diagnosticCode = 'MODEL_OUTPUT_PARSE_FAILED';
  statusCode = 502;

  constructor(message = 'Coden could not safely read the AI output, so the existing app was kept unchanged.') {
    super(message);
    this.name = 'GeneratedOutputParseError';
  }
}

export function stripJsonCodeFence(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseJsonCandidate(candidate: string): any | null {
  const clean = stripJsonCodeFence(candidate);
  if (!clean) return null;
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

function findBalancedObject(value: string): string | null {
  const source = String(value || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (start === -1) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  return null;
}

export function extractGeneratedJson(value: string): any | null {
  const source = String(value || '').trim();
  if (!source) return null;

  const direct = parseJsonCandidate(source);
  if (direct) return direct;

  const fenceRegex = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(source))) {
    const parsed = parseJsonCandidate(match[1] || '');
    if (parsed) return parsed;
  }

  const balanced = findBalancedObject(source);
  if (balanced) {
    const parsed = parseJsonCandidate(balanced);
    if (parsed) return parsed;
  }

  return null;
}

function languageFromPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.ts')) return 'ts';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.txt')) return 'text';
  return '';
}

function pathFromFenceLanguage(language: string, content: string, index: number) {
  const normalized = language.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'tsx' || normalized === 'jsx') return index === 0 ? 'src/App.tsx' : `src/generated-${index + 1}.${normalized}`;
  if (normalized === 'ts') return `src/generated-${index + 1}.ts`;
  if (normalized === 'js') return `src/generated-${index + 1}.js`;
  if (normalized === 'css') return 'src/index.css';
  if (normalized === 'html') return 'index.html';
  if (normalized === 'sql') return 'supabase/schema.sql';
  if (normalized === 'json') {
    return /"scripts"\s*:|"dependencies"\s*:|"devDependencies"\s*:/i.test(content) ? 'package.json' : `src/data/generated-${index + 1}.json`;
  }
  if (normalized === 'markdown' || normalized === 'md') return index === 0 ? 'README.md' : `docs/generated-${index + 1}.md`;
  return '';
}

function cleanPathCandidate(value: string) {
  const source = String(value || '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s*/, '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*(?:file|path|fichier)\s*:\s*/i, '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[`'"]/g, '')
    .trim();

  const pathPattern = /((?:\.\/)?(?:src|public|supabase|components|pages|app|lib|server|tests?|__tests__|styles|assets|docs)\/[A-Za-z0-9_./-]+\.(?:tsx|jsx|ts|js|mjs|cjs|css|html|json|sql|md|xml|txt)|(?:package|tsconfig|vite\.config|index|README|robots|sitemap)\.(?:json|ts|js|html|md|txt|xml))/i;
  const match = source.match(pathPattern);
  if (!match?.[1]) return '';
  return match[1].replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

function findPathForFence(source: string, fenceIndex: number, info: string, content: string, fileIndex: number) {
  const infoPath = cleanPathCandidate(info);
  if (infoPath) return infoPath;

  const before = source.slice(Math.max(0, fenceIndex - 320), fenceIndex);
  const previousLines = before.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-8).reverse();
  for (const line of previousLines) {
    const path = cleanPathCandidate(line);
    if (path) return path;
  }

  const language = String(info || '').split(/\s+/)[0] || '';
  return pathFromFenceLanguage(language, content, fileIndex);
}

export function extractGeneratedMarkdownFiles(value: string): any | null {
  const source = String(value || '').trim();
  if (!source || !/```/.test(source)) return null;

  const files: Array<{ path: string; content: string; language?: string }> = [];
  const seen = new Set<string>();
  const fenceRegex = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(source))) {
    const info = String(match[1] || '').trim();
    const content = String(match[2] || '').replace(/\s+$/g, '');
    if (content.trim().length < 20) continue;
    if (/^(json|javascript|js)?$/i.test(info.trim()) && parseJsonCandidate(content)) continue;

    const path = findPathForFence(source, match.index, info, content, files.length);
    if (!path || seen.has(path)) continue;

    seen.add(path);
    files.push({
      path,
      content,
      language: languageFromPath(path) || info.split(/\s+/)[0] || undefined,
    });
  }

  if (!files.length) return null;
  return {
    summary: 'Generated project files from markdown source blocks.',
    files,
  };
}

export function looksLikeStandaloneHtml(value: string): boolean {
  const source = String(value || '').trim();
  return /<!doctype\s+html|<html[\s>]/i.test(source) && /<\/html>/i.test(source);
}

export function looksLikeRawGeneratedEnvelope(value: string): boolean {
  const source = String(value || '');
  return /```json[\s\S]*"files"\s*:/i.test(source)
    || /"summary"\s*:[\s\S]*"files"\s*:/i.test(source)
    || /Generated by Coden[\s\S]*```json/i.test(source);
}
