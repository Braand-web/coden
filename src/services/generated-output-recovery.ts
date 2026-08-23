// Generated Output Recovery — robust salvage for raw model output.
//
// Closes the gap that made Coden dump model planning JSON into the preview and
// fall back to a generic "Intake/Review/Launch" template even when the user
// asked for something specific (calculator, etc.).
//
// Pure, no I/O — every detector and salvager is unit-tested.
//
// Three responsibilities:
//   1. classifyModelOutput(raw): is this real files, a plan envelope ({plan, message}),
//      a chat answer, a truncated JSON, or unparseable?
//   2. salvageFiles(raw): try harder than the strict parser — repair common JSON
//      truncations, lift files out of nested envelopes, recover markdown blocks
//      that miss a path.
//   3. extractPlanFromEnvelope(raw): pull the plan + user message out of an
//      envelope so the runtime can route it as a *plan* turn instead of dumping it.

export type ModelOutputKind =
  | 'files'           // real project files — proceed to build
  | 'plan_envelope'   // { plan, message } — must be routed as plan, not built
  | 'chat_answer'     // plain assistant text — answer mode, no files
  | 'truncated_json'  // looks like JSON but cuts off — try repair
  | 'unparseable';    // last resort — rescue scaffold

export type SalvagedFile = {
  path: string;
  content: string;
  language?: string;
};

export type SalvagedOutput = {
  summary: string;
  files: SalvagedFile[];
};

export type PlanEnvelope = {
  /** Free-form plan body (object/string) extracted from the envelope. */
  plan: unknown;
  /** Optional user-visible message that came with the plan. */
  message?: string;
};

const FILES_HINT = /"files"\s*:\s*\[/i;
const PLAN_HINT = /"plan"\s*:\s*\{/i;
const MESSAGE_HINT = /"message"\s*:\s*"/i;
const FENCE_RE = /```[\s\S]*?```/i;

function findBalanced(source: string, openIdx: number): string | null {
  if (openIdx < 0 || source[openIdx] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return source.slice(openIdx, i + 1); }
  }
  return null;
}

function tryParse(value: string): any | null {
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * Repair a JSON string that was truncated mid-stream (missing closing braces,
 * unfinished string, trailing comma). Tracks the open-bracket order as a stack
 * so closers are emitted in the correct sequence.
 */
export function repairTruncatedJson(raw: string): any | null {
  const source = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!source.startsWith('{') && !source.startsWith('[')) return null;
  // Try the original first.
  const direct = tryParse(source);
  if (direct) return direct;
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let lastStructural = -1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; if (!inString) lastStructural = i; continue; }
    if (inString) continue;
    if (ch === '{') { stack.push('}'); lastStructural = i; }
    else if (ch === '[') { stack.push(']'); lastStructural = i; }
    else if (ch === '}' || ch === ']') { stack.pop(); lastStructural = i; }
    else if (/\S/.test(ch)) lastStructural = i;
  }
  let cut = lastStructural >= 0 ? source.slice(0, lastStructural + 1) : source;
  if (inString) cut += '"';
  cut = cut.replace(/,\s*$/, '');
  while (stack.length) cut += stack.pop();
  return tryParse(cut);
}

/** Pull every plausible {...} JSON object out of free-form text. */
function extractEveryObject(source: string): any[] {
  const out: any[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{') continue;
    const balanced = findBalanced(source, i);
    if (!balanced) continue;
    const parsed = tryParse(balanced);
    if (parsed && typeof parsed === 'object') out.push(parsed);
    i += balanced.length - 1;
  }
  return out;
}

function looksLikeFilesArray(value: unknown): value is SalvagedFile[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => item && typeof item === 'object' && typeof (item as any).path === 'string' && typeof (item as any).content === 'string');
}

/**
 * Best-effort: find a files[] array anywhere in the raw output, including inside
 * nested envelopes like { plan, files }, { result: { files } }, etc.
 */
export function liftFilesAnywhere(raw: string): SalvagedFile[] | null {
  const source = String(raw || '');
  if (!source) return null;
  // First parse attempts.
  const direct = tryParse(source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
  const repaired = direct || repairTruncatedJson(source);
  const candidates: any[] = [];
  if (repaired) candidates.push(repaired);
  candidates.push(...extractEveryObject(source));
  for (const candidate of candidates) {
    const found = findFilesArrayInValue(candidate);
    if (found && looksLikeFilesArray(found)) {
      return found.map(item => ({
        path: String(item.path),
        content: String(item.content),
        language: typeof (item as any).language === 'string' ? (item as any).language : undefined,
      }));
    }
  }
  return null;
}

function findFilesArrayInValue(value: any, depth = 0): SalvagedFile[] | null {
  if (depth > 6 || value == null || typeof value !== 'object') return null;
  if (looksLikeFilesArray((value as any).files)) return (value as any).files as SalvagedFile[];
  for (const v of Object.values(value)) {
    if (Array.isArray(v) && looksLikeFilesArray(v)) return v as unknown as SalvagedFile[];
    if (v && typeof v === 'object') {
      const nested = findFilesArrayInValue(v, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Detect the planning envelope shape — `{ plan: {...}, message: "..." }` —
 * that the model sometimes returns when it intended to discuss before building.
 * Returns the extracted plan + message so the runtime can route it as a plan
 * turn instead of dumping the JSON into the preview.
 */
export function extractPlanEnvelope(raw: string): PlanEnvelope | null {
  const source = String(raw || '');
  if (!PLAN_HINT.test(source)) return null;
  // Already files? not a plan envelope.
  if (FILES_HINT.test(source) && /"files"\s*:\s*\[\s*\{/i.test(source)) {
    // unless files array is empty.
    const filesEmpty = /"files"\s*:\s*\[\s*\]/i.test(source);
    if (!filesEmpty) return null;
  }
  const stripped = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = tryParse(stripped) || repairTruncatedJson(stripped) || extractEveryObject(source).find(obj => obj && obj.plan);
  if (parsed && parsed.plan) {
    return {
      plan: parsed.plan,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
    };
  }
  return null;
}

/** Looks like a plain assistant message — no JSON, no code fences. */
function looksLikeChatAnswer(raw: string): boolean {
  const source = String(raw || '').trim();
  if (!source) return false;
  if (source.startsWith('{') || source.startsWith('[')) return false;
  if (FENCE_RE.test(source)) return false;
  // Has prose-like punctuation and no JSON structural markers.
  return source.length < 4000 && /[.!?]/.test(source) && !/"\s*:\s*"/.test(source);
}

export function classifyModelOutput(raw: string): ModelOutputKind {
  const source = String(raw || '').trim();
  if (!source) return 'unparseable';

  // Real files lifted from anywhere → files
  if (liftFilesAnywhere(source)) return 'files';

  // Plan envelope (must NOT be dumped into the preview)
  if (extractPlanEnvelope(source)) return 'plan_envelope';

  // Direct/parseable JSON that just *mentions* plan / message → plan envelope
  if (PLAN_HINT.test(source) && MESSAGE_HINT.test(source)) return 'plan_envelope';

  // Looks like JSON but malformed
  if ((source.startsWith('{') || source.startsWith('[')) && !tryParse(source)) {
    return 'truncated_json';
  }

  if (looksLikeChatAnswer(source)) return 'chat_answer';

  return 'unparseable';
}

/**
 * Top-level salvage: try every recovery path before letting the strict parser
 * bail. Returns null when nothing safe can be extracted.
 */
export function salvageFiles(raw: string): SalvagedOutput | null {
  const lifted = liftFilesAnywhere(raw);
  if (lifted && lifted.length > 0) {
    return { summary: 'Recovered project files from the model output.', files: lifted };
  }
  return null;
}
