/**
 * Reasoning Pipeline — the brain that makes Coden *think out loud* instead of
 * reciting hardcoded status strings.
 *
 * Two jobs:
 *
 *  1. **Synthesized reasoning** (provider-agnostic): instruct any model to emit
 *     its work as a stream of newline-delimited JSON (NDJSON) records —
 *     understanding → reasoning → plan → files → done. Each record is one line,
 *     so the UI can render the agent's understanding, plan and per-file progress
 *     in real time, on every model (OpenRouter, Deepseek, Claude…), no native
 *     "thinking" tokens required.
 *
 *  2. **Robust incremental parsing**: a streaming NDJSON parser that yields
 *     records as whole lines arrive. A truncated response only loses the last
 *     partial line — never the whole generation. This is what kills the
 *     "Unexpected end of JSON input" total-failure crash.
 *
 * Pure & dependency-light: only imports shared types. No I/O, fully unit-tested.
 */

import type {
  CodenDecision,
} from './decision-core.ts';
import type {
  CodenPlanStep,
  CodenReasoningPhase,
} from '../lib/stream-protocol.ts';

// ───────────────────────────────────────────────────────────────────────────
// NDJSON record shapes (what the model emits, one JSON object per line)
// ───────────────────────────────────────────────────────────────────────────

export type ReasoningRecord =
  | { t: 'understanding'; summary: string; projectType?: string; requirements?: string[] }
  | { t: 'reason'; text: string }
  | { t: 'plan'; steps: ReasoningPlanStep[] }
  | { t: 'plan_step'; id: string; state: 'active' | 'done' | 'failed' }
  | { t: 'file'; path: string; content: string; language?: string }
  | { t: 'note'; text: string }
  | { t: 'done' };

export type ReasoningPlanStep = {
  id: string;
  title: string;
  kind?: 'create' | 'edit' | 'delete' | 'task';
  path?: string;
};

export type ParsedReasoningResult = {
  understanding?: { summary: string; projectType?: string; requirements: string[] };
  reasoning: string;
  plan: CodenPlanStep[];
  files: Array<{ path: string; content: string; language?: string }>;
  notes: string[];
  /** True when a terminal `done` record was seen — generation completed cleanly. */
  completed: boolean;
  /** Lines that could not be parsed (telemetry / debugging). */
  malformedLines: number;
};

// ───────────────────────────────────────────────────────────────────────────
// Prompt instruction — teaches the model the NDJSON reasoning protocol
// ───────────────────────────────────────────────────────────────────────────

/**
 * The output-format contract appended to the generation prompt. Kept terse and
 * imperative — models follow short, example-led format rules far more reliably
 * than prose. The order matters: understanding first (so the user immediately
 * sees the agent "gets it"), then reasoning, then the plan, then files.
 */
export function buildReasoningInstruction(): string {
  return [
    'OUTPUT FORMAT — STREAM OF NDJSON (one JSON object per line, no markdown, no code fences):',
    'Emit, in this exact order:',
    '1. One "understanding" line restating the goal in the user\'s language:',
    '   {"t":"understanding","summary":"…","projectType":"…","requirements":["…","…"]}',
    '2. One or more "reason" lines thinking through the approach (short, concrete):',
    '   {"t":"reason","text":"…"}',
    '3. One "plan" line listing the files/steps as a checklist:',
    '   {"t":"plan","steps":[{"id":"s1","title":"…","kind":"create","path":"src/App.tsx"}]}',
    '4. One "file" line PER file with its full content (newlines escaped as \\n):',
    '   {"t":"file","path":"src/App.tsx","content":"…","language":"tsx"}',
    '5. A final terminal line:',
    '   {"t":"done"}',
    'Rules: exactly one JSON object per line. Never wrap output in ``` fences.',
    'Keep "reason" lines honest and specific — they are shown to the user as the agent thinking.',
    'Every file referenced in the plan must have a matching "file" line.',
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// Streaming NDJSON parser
// ───────────────────────────────────────────────────────────────────────────

const FENCE_LINE_RE = /^\s*```(?:ndjson|json|jsonl)?\s*$/i;

/**
 * Incremental NDJSON parser. Push raw text chunks as they stream in; receive
 * the records that just completed. Call `flush()` at the end to recover a final
 * line that wasn't newline-terminated.
 *
 *   const parser = createNdjsonReasoningParser();
 *   for await (const chunk of stream) emit(parser.push(chunk));
 *   emit(parser.flush());
 */
export function createNdjsonReasoningParser() {
  let buffer = '';
  let malformed = 0;

  function parseLine(rawLine: string): ReasoningRecord | null {
    const line = rawLine.trim();
    if (!line) return null;
    if (FENCE_LINE_RE.test(line)) return null; // tolerate stray ``` fences
    try {
      const obj = JSON.parse(line) as unknown;
      return coerceRecord(obj);
    } catch {
      malformed += 1;
      return null;
    }
  }

  return {
    /** Feed a chunk; returns records completed by this chunk. */
    push(chunk: string): ReasoningRecord[] {
      if (!chunk) return [];
      buffer += chunk;
      const records: ReasoningRecord[] = [];
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const record = parseLine(rawLine);
        if (record) records.push(record);
        newlineIndex = buffer.indexOf('\n');
      }
      return records;
    },

    /** Recover the trailing (non-newline-terminated) line, if any. */
    flush(): ReasoningRecord[] {
      const remaining = buffer;
      buffer = '';
      if (!remaining.trim()) return [];
      const record = parseLine(remaining);
      if (record) return [record];
      // Last-ditch: salvage a balanced JSON object from a truncated final line
      // (e.g. a huge "file" record cut off mid-content).
      const salvaged = salvageTruncatedRecord(remaining);
      if (salvaged) return [salvaged];
      return [];
    },

    get malformedLines(): number {
      return malformed;
    },
  };
}

/** Validate/normalize an arbitrary parsed object into a ReasoningRecord. */
function coerceRecord(obj: unknown): ReasoningRecord | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const t = rec.t;
  switch (t) {
    case 'understanding':
      if (typeof rec.summary !== 'string') return null;
      return {
        t: 'understanding',
        summary: rec.summary,
        projectType: typeof rec.projectType === 'string' ? rec.projectType : undefined,
        requirements: Array.isArray(rec.requirements)
          ? rec.requirements.filter((r): r is string => typeof r === 'string')
          : [],
      };
    case 'reason':
      if (typeof rec.text !== 'string') return null;
      return { t: 'reason', text: rec.text };
    case 'plan':
      return { t: 'plan', steps: coercePlanSteps(rec.steps) };
    case 'plan_step':
      if (typeof rec.id !== 'string') return null;
      return {
        t: 'plan_step',
        id: rec.id,
        state: rec.state === 'done' || rec.state === 'failed' ? rec.state : 'active',
      };
    case 'file':
      if (typeof rec.path !== 'string' || typeof rec.content !== 'string') return null;
      return {
        t: 'file',
        path: rec.path,
        content: rec.content,
        language: typeof rec.language === 'string' ? rec.language : undefined,
      };
    case 'note':
      if (typeof rec.text !== 'string') return null;
      return { t: 'note', text: rec.text };
    case 'done':
      return { t: 'done' };
    default:
      return null;
  }
}

function coercePlanSteps(value: unknown): ReasoningPlanStep[] {
  if (!Array.isArray(value)) return [];
  const steps: ReasoningPlanStep[] = [];
  for (let i = 0; i < value.length; i++) {
    const raw = value[i];
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const title = typeof s.title === 'string' ? s.title : typeof s.path === 'string' ? s.path : '';
    if (!title) continue;
    steps.push({
      id: typeof s.id === 'string' && s.id ? s.id : `s${i + 1}`,
      title,
      kind:
        s.kind === 'edit' || s.kind === 'delete' || s.kind === 'task' || s.kind === 'create'
          ? s.kind
          : undefined,
      path: typeof s.path === 'string' ? s.path : undefined,
    });
  }
  return steps;
}

/**
 * Best-effort recovery of a single object from a truncated final line. Used
 * only by flush() when the stream was cut mid-record. Returns a `file` record
 * if a path and a partial content string can be extracted, else null.
 */
function salvageTruncatedRecord(text: string): ReasoningRecord | null {
  const trimmed = text.trim().replace(/^```(?:ndjson|json|jsonl)?/i, '').trim();
  if (!trimmed.startsWith('{')) return null;
  // Try progressively shorter prefixes that close cleanly — cheap and bounded.
  // First, attempt a direct parse with a closing brace appended.
  for (const suffix of ['', '"}', '}', '"]}']) {
    try {
      const candidate = JSON.parse(trimmed + suffix) as unknown;
      const rec = coerceRecord(candidate);
      if (rec) return rec;
    } catch {
      // keep trying
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Aggregation — fold a record stream into a final result
// ───────────────────────────────────────────────────────────────────────────

export function createReasoningAccumulator() {
  const result: ParsedReasoningResult = {
    reasoning: '',
    plan: [],
    files: [],
    notes: [],
    completed: false,
    malformedLines: 0,
  };
  const seenFilePaths = new Set<string>();

  return {
    add(record: ReasoningRecord): void {
      switch (record.t) {
        case 'understanding':
          result.understanding = {
            summary: record.summary,
            projectType: record.projectType,
            requirements: record.requirements ?? [],
          };
          break;
        case 'reason':
          result.reasoning += (result.reasoning ? '\n' : '') + record.text;
          break;
        case 'plan':
          result.plan = record.steps.map((s, i) => ({
            id: s.id || `s${i + 1}`,
            title: s.title,
            kind: s.kind ?? inferKindFromPath(s.path),
            path: s.path,
          }));
          break;
        case 'file': {
          // Last write wins for a given path (model may re-emit a corrected file).
          if (seenFilePaths.has(record.path)) {
            const idx = result.files.findIndex(f => f.path === record.path);
            if (idx !== -1) result.files[idx] = { path: record.path, content: record.content, language: record.language };
          } else {
            seenFilePaths.add(record.path);
            result.files.push({ path: record.path, content: record.content, language: record.language });
          }
          break;
        }
        case 'note':
          result.notes.push(record.text);
          break;
        case 'done':
          result.completed = true;
          break;
        case 'plan_step':
          // Plan-step transitions are streaming-only; nothing to aggregate.
          break;
      }
    },
    addMany(records: ReasoningRecord[]): void {
      for (const r of records) this.add(r);
    },
    finalize(malformedLines = 0): ParsedReasoningResult {
      result.malformedLines = malformedLines;
      return result;
    },
    get current(): ParsedReasoningResult {
      return result;
    },
  };
}

function inferKindFromPath(path?: string): CodenPlanStep['kind'] {
  if (!path) return 'task';
  return 'create';
}

// ───────────────────────────────────────────────────────────────────────────
// Decision → reasoning bridge (the "no more guessing" guarantee)
// ───────────────────────────────────────────────────────────────────────────

export type ReasoningPhaseEvent =
  | { kind: 'phase'; phase: CodenReasoningPhase; state: 'active' | 'done' | 'failed'; label?: string }
  | { kind: 'understanding'; summary: string; projectType?: string; requirements: string[]; confidence?: number }
  | { kind: 'assumption'; text: string }
  | { kind: 'clarification'; question: string; options?: string[] }
  | { kind: 'reasoning_delta'; text: string };

/**
 * Translate a DecisionCore output into the opening reasoning events. This is the
 * structural answer to "il ne doit plus deviner": when the decision is to
 * clarify, we emit a clarification event and STOP — the agent asks instead of
 * guessing. Otherwise we surface what it understood plus any assumptions before
 * it touches a single file.
 */
export function narrateDecision(decision: CodenDecision): ReasoningPhaseEvent[] {
  const events: ReasoningPhaseEvent[] = [];

  // Phase 1: understand.
  events.push({ kind: 'phase', phase: 'understand', state: 'active' });
  events.push({
    kind: 'understanding',
    summary: decision.intent?.reason || decision.rationale,
    projectType: decision.intent?.category,
    requirements: extractRequirements(decision),
    confidence: decision.confidence,
  });
  events.push({ kind: 'phase', phase: 'understand', state: 'done' });

  // Phase 2: decide.
  events.push({ kind: 'phase', phase: 'decide', state: 'active' });
  events.push({ kind: 'reasoning_delta', text: decision.rationale });

  if (decision.action === 'clarify' && decision.clarifying_question) {
    // No guessing — ask and stop here.
    events.push({ kind: 'clarification', question: decision.clarifying_question });
    events.push({ kind: 'phase', phase: 'decide', state: 'done' });
    return events;
  }

  for (const assumption of decision.assumptions || []) {
    events.push({ kind: 'assumption', text: assumption });
  }
  events.push({ kind: 'phase', phase: 'decide', state: 'done' });

  return events;
}

/** True when the decision means we should pause for the user (no file changes). */
export function decisionRequiresPause(decision: CodenDecision): boolean {
  return (
    decision.action === 'clarify' ||
    decision.action === 'critical_action' ||
    decision.action === 'refuse_redirect'
  );
}

/** Human labels for the complexity/intent signals the decision core detected. */
const REQUIREMENT_LABELS: Record<string, string> = {
  auth: 'Authentification',
  payments: 'Paiements',
  database: 'Base de données',
  realtime: 'Temps réel',
  storage: 'Stockage de fichiers',
  roles: 'Rôles & permissions',
  integrations: 'Intégrations / API',
  ai: 'Fonctionnalités IA',
};

/**
 * Derive a human-readable requirement checklist from the decision's detected
 * signals (complexity hints + intent signals). Deduplicated and label-mapped.
 */
function extractRequirements(decision: CodenDecision): string[] {
  const seen = new Set<string>();
  const reqs: string[] = [];
  for (const signal of decision.signals || []) {
    const label = REQUIREMENT_LABELS[signal];
    if (label && !seen.has(label)) {
      seen.add(label);
      reqs.push(label);
    }
  }
  return reqs;
}
