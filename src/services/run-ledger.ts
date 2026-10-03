/**
 * An agent run row that was never closed, though the turn it belongs to finished.
 *
 * The boot reaper stamps every run still `running` as `RUN_INTERRUPTED`. Some of those rows belong to work that was
 * in fact finished — the turn is `completed` — and only the ledger row was left open. Calling them interruptions made
 * the old run views read far worse than the product behaves. The turn is the truth: a run that has a completed turn
 * explicitly linked to the run is settled as completed instead. Time proximity is not identity.
 */
export type OpenRun = { id: string; project_id: string; created_at: string; context_summary?: { harness_turn_id?: string } | null };
export type TurnOfProject = { id: string; project_id: string; status: string; created_at: string; completed_at?: string | null };

export function findCompletedTurnForRun(run: OpenRun, turns: TurnOfProject[]): TurnOfProject | null {
  const turnId = run.context_summary?.harness_turn_id;
  const runAt = Date.parse(run.created_at);
  if (!turnId || !Number.isFinite(runAt)) return null;
  const matches = turns.filter(turn => turn.id === turnId && turn.project_id === run.project_id);
  if (matches.length !== 1) return null;
  const turn = matches[0];
  const start = Date.parse(turn.created_at);
  const end = Date.parse(turn.completed_at || '');
  return turn.status === 'completed' && Number.isFinite(start) && Number.isFinite(end)
    && start <= end && end >= runAt ? turn : null;
}
