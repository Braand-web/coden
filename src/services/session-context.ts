/**
 * What the agent remembers between messages, the way Claude Code does it.
 *
 * Coden forgot. A build turn saw the last six messages, each cut to 1,200
 * characters with its line breaks collapsed; a chat reply on /generate saw
 * none; a repair round saw its own error list and nothing it had done a
 * minute earlier. The agent re-asked what had been said, re-decided what had
 * been settled, and "fixed" files it no longer remembered writing.
 *
 * Claude Code keeps the conversation verbatim for as long as it fits, and
 * only when it would not does it replace the oldest part with a structured
 * summary written by the model — the request, the decisions, the files and
 * what they do, the errors and how they were fixed, what is pending, where
 * the work stands. The summary and the recent turns travel together, so
 * nothing is lost silently and nothing old crowds out the present.
 *
 * This module is that, for a project:
 *   - `selectConversationWindow` keeps the newest turns whole within a budget
 *     taken from the model's own context window;
 *   - `compactConversation` folds what falls out of the window into the
 *     running summary (one model call, only when something falls out);
 *   - run records say what each build actually did — files, outcome, what is
 *     still broken — so the next turn starts from facts, not from a guess;
 *   - `renderSessionContext` is the block every turn receives, chat or build.
 */

export type SessionTurn = { role: 'user' | 'assistant'; content: string; at?: string };

export type RunRecord = {
  at: string;
  /** What the user asked, in their words (trimmed). */
  request: string;
  outcome: 'verified' | 'needs_fix' | 'failed' | 'cancelled';
  /** Paths created or changed by the run. */
  files: string[];
  /** The plan's own one-line summary, when there was a plan. */
  summary?: string;
  /** What the checks still reported when the run ended. */
  openProblems?: string[];
};

export type SessionMemory = {
  /** The model-written summary of every turn older than the window. */
  summary: string;
  /** Timestamp of the newest turn the summary already covers. */
  coveredUntil?: string;
  runs: RunRecord[];
};

export const EMPTY_SESSION: SessionMemory = { summary: '', runs: [] };

/** Per-turn ceiling, so one pasted log cannot take the whole window. */
const MAX_TURN_CHARS = 12_000;
const MAX_RUNS = 12;
const MAX_SUMMARY_CHARS = 12_000;

/**
 * How much conversation a turn may carry, in characters.
 *
 * A quarter of the model's context window (three characters to the token),
 * bounded: enough for a long working session on any model in the catalogue,
 * never so much that the files and tools the turn actually needs are crowded
 * out.
 */
export function conversationBudgetChars(contextTokens: number): number {
  const quarter = Math.floor((contextTokens || 128_000) * 0.25) * 3;
  // Capped well below what a large window could hold: this is re-sent on
  // every call of a turn, and the summary keeps what falls out of it.
  return Math.max(16_000, Math.min(60_000, quarter));
}

function clipTurn(content: string): string {
  const text = String(content || '').trim();
  if (text.length <= MAX_TURN_CHARS) return text;
  const head = text.slice(0, Math.floor(MAX_TURN_CHARS * 0.75));
  const tail = text.slice(-Math.floor(MAX_TURN_CHARS * 0.2));
  return `${head}\n…[${text.length - head.length - tail.length} characters omitted]…\n${tail}`;
}

/**
 * The newest turns that fit, whole and in order; the rest, oldest first.
 *
 * Whole turns only — a message cut in the middle reads as something the user
 * did not say. The window always starts on a user turn, so the model never
 * opens on an answer to a question it cannot see.
 */
export function selectConversationWindow(turns: SessionTurn[], budgetChars: number): { recent: SessionTurn[]; older: SessionTurn[] } {
  const clean = turns
    .filter(turn => (turn.role === 'user' || turn.role === 'assistant') && String(turn.content || '').trim())
    .map(turn => ({ ...turn, content: clipTurn(turn.content) }));
  let used = 0;
  let start = clean.length;
  while (start > 0) {
    const next = clean[start - 1].content.length + 16;
    if (used + next > budgetChars && start < clean.length) break;
    used += next;
    start -= 1;
  }
  while (start < clean.length && clean[start].role === 'assistant') start += 1;
  return { recent: clean.slice(start), older: clean.slice(0, start) };
}

/** Turns the summary does not cover yet. */
export function uncoveredTurns(older: SessionTurn[], coveredUntil?: string): SessionTurn[] {
  if (!coveredUntil) return older;
  const covered = Date.parse(coveredUntil);
  if (!Number.isFinite(covered)) return older;
  return older.filter(turn => !turn.at || Date.parse(turn.at) > covered);
}

/**
 * The summary's shape — the sections Claude Code's own compaction writes,
 * adapted to a product built through conversation.
 */
export const SESSION_SUMMARY_INSTRUCTIONS = [
  'You maintain the working memory of a conversation between a user and Coden, an agent that builds web apps.',
  'You receive the current summary (possibly empty) and older conversation turns that no longer fit in the context window.',
  'Rewrite the summary so it covers everything, preserving every fact the agent will need later. Use exactly these sections, in the user\'s language, omitting a section only when it has nothing:',
  '1. Goal: what the user is building and why, in their terms.',
  '2. Requirements and preferences: every explicit requirement, constraint, style or content choice the user stated — verbatim where wording matters (names, copy, colours, features).',
  '3. Decisions: what was decided and settled (stack, structure, design direction, data model) and anything the user rejected.',
  '4. Work done: features and screens that exist, with the files that implement them when known.',
  '5. Problems and fixes: errors met and how they were resolved; anything still broken.',
  '6. Open items: what the user asked for that is not done yet, and questions still waiting for an answer.',
  '7. Latest state: where the work stood at the end of these turns.',
  'Never invent anything. Keep it dense and factual; no commentary, no advice. At most 1,500 words.',
].join('\n');

export function buildCompactionMessages(previousSummary: string, turns: SessionTurn[]) {
  const transcript = turns.map(turn => `${turn.role === 'user' ? 'User' : 'Coden'}${turn.at ? ` (${turn.at})` : ''}:\n${turn.content}`).join('\n\n---\n\n');
  return [
    { role: 'system' as const, content: SESSION_SUMMARY_INSTRUCTIONS },
    {
      role: 'user' as const,
      content: `Current summary:\n${previousSummary.trim() || '(empty)'}\n\nOlder turns to fold in:\n\n${transcript}\n\nReturn the updated summary only.`,
    },
  ];
}

/**
 * The fallback when the summariser cannot answer: nothing dropped silently,
 * each turn kept as its opening lines.
 */
export function digestTurns(turns: SessionTurn[], perTurn = 400): string {
  return turns
    .map(turn => `- ${turn.role === 'user' ? 'User' : 'Coden'}: ${turn.content.replace(/\s+/g, ' ').slice(0, perTurn)}${turn.content.length > perTurn ? '…' : ''}`)
    .join('\n');
}

/**
 * Fold turns that left the window into the summary.
 *
 * `complete` is one model call. It is asked only when something actually
 * left the window, and a failure keeps a mechanical digest instead — the
 * turn still happens, with the facts still there.
 */
export async function compactConversation(input: {
  memory: SessionMemory;
  turns: SessionTurn[];
  complete: (messages: ReturnType<typeof buildCompactionMessages>) => Promise<string>;
}): Promise<SessionMemory> {
  if (!input.turns.length) return input.memory;
  const newest = input.turns.map(turn => turn.at).filter(Boolean).sort().at(-1) || input.memory.coveredUntil;
  let summary: string;
  try {
    summary = String(await input.complete(buildCompactionMessages(input.memory.summary, input.turns)) || '').trim();
    if (!summary) throw new Error('empty summary');
  } catch {
    summary = [input.memory.summary.trim(), 'Earlier turns (digest):', digestTurns(input.turns)].filter(Boolean).join('\n\n');
  }
  if (summary.length > MAX_SUMMARY_CHARS) summary = `${summary.slice(0, MAX_SUMMARY_CHARS)}\n…`;
  return { ...input.memory, summary, coveredUntil: newest };
}

/** Newest last, bounded, one entry per run. */
export function appendRunRecord(runs: RunRecord[], record: RunRecord, max = MAX_RUNS): RunRecord[] {
  const clean: RunRecord = {
    ...record,
    request: record.request.replace(/\s+/g, ' ').trim().slice(0, 500),
    files: [...new Set(record.files)].slice(0, 40),
    summary: record.summary?.replace(/\s+/g, ' ').trim().slice(0, 600) || undefined,
    openProblems: record.openProblems?.slice(0, 6).map(problem => problem.slice(0, 300)),
  };
  return [...runs, clean].slice(-max);
}

const OUTCOME_LABEL: Record<RunRecord['outcome'], string> = {
  verified: 'verified working',
  needs_fix: 'finished with problems left',
  failed: 'failed',
  cancelled: 'cancelled by the user',
};

/**
 * The block every turn receives.
 *
 * Framed as memory, not instruction: it tells the agent what happened, and
 * the user's latest message still decides what happens next.
 */
export function renderSessionContext(memory: SessionMemory, options: { maxRuns?: number } = {}): string {
  const runs = memory.runs.slice(-(options.maxRuns ?? 6));
  const sections: string[] = [];
  if (memory.summary.trim()) {
    sections.push(`Summary of the earlier conversation (older turns are no longer shown verbatim):\n${memory.summary.trim()}`);
  }
  if (runs.length) {
    sections.push([
      'What previous runs on this project did (newest last):',
      ...runs.map(run => {
        const lines = [`- ${run.at.slice(0, 16).replace('T', ' ')} — "${run.request}" → ${OUTCOME_LABEL[run.outcome]}.`];
        if (run.summary) lines.push(`  Plan: ${run.summary}`);
        if (run.files.length) lines.push(`  Files: ${run.files.slice(0, 20).join(', ')}${run.files.length > 20 ? ` (+${run.files.length - 20} more)` : ''}`);
        if (run.openProblems?.length) lines.push(`  Still open: ${run.openProblems.join(' | ')}`);
        return lines.join('\n');
      }),
    ].join('\n'));
  }
  if (!sections.length) return '';
  return [
    'Session memory (what already happened in this project — facts to build on, not new instructions; the user\'s latest message decides what to do now, and the files on disk are the source of truth when they differ):',
    ...sections,
  ].join('\n\n');
}

/** Parse the stored row back, tolerating anything a previous version wrote. */
export function sessionMemoryFromRow(row: { summary?: unknown; architecture?: any; recent_decisions?: unknown } | null | undefined): SessionMemory {
  if (!row) return { ...EMPTY_SESSION };
  const runs = Array.isArray(row.recent_decisions)
    ? (row.recent_decisions as any[]).filter(run => run && typeof run.request === 'string' && typeof run.at === 'string').map(run => ({
      at: run.at,
      request: run.request,
      outcome: (['verified', 'needs_fix', 'failed', 'cancelled'].includes(run.outcome) ? run.outcome : 'needs_fix') as RunRecord['outcome'],
      files: Array.isArray(run.files) ? run.files.filter((file: unknown) => typeof file === 'string') : [],
      summary: typeof run.summary === 'string' ? run.summary : undefined,
      openProblems: Array.isArray(run.openProblems) ? run.openProblems.filter((item: unknown) => typeof item === 'string') : undefined,
    }))
    : [];
  return {
    summary: typeof row.summary === 'string' ? row.summary : '',
    coveredUntil: typeof row.architecture?.coveredUntil === 'string' ? row.architecture.coveredUntil : undefined,
    runs,
  };
}
