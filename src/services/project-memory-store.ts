/**
 * Reading and writing what a project has already decided.
 *
 * The memory itself — architecture decision records, their relevance ranking,
 * the prompt section they render into — lives in `agent-memory-rag.ts` and is
 * complete. What was missing is a way to use it from more than one place: the
 * load and save sequences existed only as two inline blocks inside
 * `generateFilesWithAi`, the legacy generation path.
 *
 * So when the multi-agent pipeline became the live path on 2026-09-03, memory
 * went dark with it. The table still holds 36 decisions and 20 token sets
 * across 20 projects, all written on or before that day, and nothing has read
 * or written one since: every run since then started from nothing, and a
 * project that had already settled on a router, a state library or a form
 * approach re-decided it from scratch on the next request.
 *
 * Extracted here verbatim from those blocks rather than rewritten, so both
 * paths behave identically and this is a move, not a redesign.
 */

import {
  buildMemoryRagContext,
  extractArchitectureDecisions,
  projectMemoryToRows,
  rowsToProjectMemory,
  selectRelevantMemoryRows,
} from './agent-memory-rag.ts';

/** The slice of a Supabase client this needs, so callers pass theirs unchanged. */
type MemoryClient = {
  from(table: string): any;
};

/**
 * The project's established decisions, as a prompt section.
 *
 * Returns an empty string when there is nothing to say — a new project, an
 * unavailable table, a query that fails. Memory is an improvement to a run,
 * never a precondition for one: a failure here must never stop a
 * generation that would otherwise work.
 */
export async function loadProjectMemoryContext(input: {
  client: MemoryClient | null;
  projectId: string;
  prompt: string;
  /** Failure modes the caller already knows about, folded in with the stored ones. */
  recentBlockers?: string[];
}): Promise<string> {
  if (!input.client || !input.projectId) return '';
  try {
    const { data } = await input.client
      .from('project_memory')
      .select('id, memory_type, content, created_at, updated_at')
      .eq('project_id', input.projectId)
      .order('created_at', { ascending: false })
      .limit(120);
    if (!data?.length) return '';

    const relevant = selectRelevantMemoryRows(data as any, input.prompt, 24);
    const memory = rowsToProjectMemory(relevant as any);
    if (input.recentBlockers?.length) {
      memory.recentBlockers = [...(memory.recentBlockers || []), ...input.recentBlockers];
    }
    return buildMemoryRagContext(memory);
  } catch (error: any) {
    console.warn('[coden:project_memory_load_failed]', { message: error?.message });
    return '';
  }
}

/**
 * Record what this run decided, replacing any earlier decision on the same topic.
 *
 * A topic settled twice is one decision that changed, not two that compete, so
 * the older row is removed rather than left to contradict the newer one in the
 * next prompt.
 *
 * Returns how many decisions were stored, for the caller's log. Never throws:
 * a run that produced a working application has already succeeded, and losing
 * its memory is not a reason to report otherwise.
 */
export async function saveArchitectureDecisions(input: {
  client: MemoryClient | null;
  projectId: string;
  prompt: string;
  /** What the run reported doing — the text decisions are read out of. */
  assistantOutput: string;
}): Promise<number> {
  if (!input.client || !input.projectId || !input.assistantOutput.trim()) return 0;
  try {
    const decisions = extractArchitectureDecisions(input.prompt, input.assistantOutput);
    if (!decisions.length) return 0;

    const rows = projectMemoryToRows({ adrs: decisions, knownPreferences: [] }, input.projectId);
    const topics = new Set(decisions.map(decision => decision.topic));

    const existing = await input.client
      .from('project_memory')
      .select('id, content')
      .eq('project_id', input.projectId)
      .eq('memory_type', 'adr');
    const supersededIds = (existing.data || [])
      .filter((row: any) => {
        try { return topics.has(JSON.parse(row.content)?.topic); } catch { return false; }
      })
      .map((row: any) => row.id);
    if (supersededIds.length) {
      await input.client.from('project_memory').delete().in('id', supersededIds);
    }

    const { error } = await input.client.from('project_memory').insert(rows);
    if (error) {
      console.warn('[coden:project_memory_save_failed]', { message: error.message });
      return 0;
    }
    return rows.length;
  } catch (error: any) {
    console.warn('[coden:project_memory_save_failed]', { message: error?.message });
    return 0;
  }
}
