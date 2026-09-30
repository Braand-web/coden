/**
 * An agent run row that was never closed, though the turn it belongs to finished.
 *
 * The boot reaper stamps every run still `running` as `RUN_INTERRUPTED`. Some of those rows belong to work that was
 * in fact finished — the turn is `completed` — and only the ledger row was left open. Calling them interruptions made
 * the old run views read far worse than the product behaves. The turn is the truth: a run that has a completed turn
 * of the same project, started within a short window of it, is settled as completed instead.
 */
export type OpenRun = { id: string; project_id: string; created_at: string };
export type TurnOfProject = { id: string; project_id: string; status: string; created_at: string; completed_at?: string | null };

/** The run row is written just after its turn starts; allow for clock order and a slow insert. */
export const RUN_TURN_WINDOW_MS = 90_000;

export function findCompletedTurnForRun(run: OpenRun, turns: TurnOfProject[], windowMs = RUN_TURN_WINDOW_MS): TurnOfProject | null {
  const runAt = Date.parse(run.created_at);
  if (!Number.isFinite(runAt)) return null;
  const candidates = turns
    .filter(turn => turn.project_id === run.project_id && turn.status === 'completed')
    .map(turn => ({ turn, gap: runAt - Date.parse(turn.created_at) }))
    // The turn starts first (the gap is positive) and the run follows within the window; a turn that started
    // after the run belongs to the next request.
    .filter(({ gap }) => Number.isFinite(gap) && gap >= -5_000 && gap <= windowMs)
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
  return candidates[0]?.turn || null;
}
