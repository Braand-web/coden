/**
 * After a successful run: decide whether to propose, ask a small model for
 * ideas, keep the good ones and store them. Never on the path a person waits
 * on (the caller does not await it), never throws, never changes their app.
 */
import { buildProposalPrompt, parseProposals, selectProposals, shouldPropose, type ProposalContext } from './proposal-engine.ts';
import type { ProposalStore, StoredProposal } from './proposal-store.ts';

export type ProposeAfterRunInput = {
  store: ProposalStore;
  ask: (prompt: string) => Promise<string>;
  projectId: string;
  userId: string;
  runOk: boolean;
  /** Versions saved since the last batch, or a large number when there has been none. */
  runsSinceLastBatch: number;
  isFirstRun?: boolean;
  context: Omit<ProposalContext, 'known'>;
};

export type ProposeOutcome = { proposed: StoredProposal[]; skipped: string };

export async function proposeAfterRun(input: ProposeAfterRunInput): Promise<ProposeOutcome> {
  try {
    const level = await input.store.level(input.userId);
    const history = await input.store.history(input.projectId, input.userId, input.runsSinceLastBatch);
    const gate = shouldPropose({ level, runOk: input.runOk, history, isFirstRun: input.isFirstRun });
    if (!gate.propose) return { proposed: [], skipped: gate.reason };
    const answer = await input.ask(buildProposalPrompt({ ...input.context, known: history.titles }, gate.count));
    const chosen = selectProposals(parseProposals(answer), history, gate.count);
    if (!chosen.length) return { proposed: [], skipped: 'nothing_useful' };
    return { proposed: await input.store.add(input.projectId, input.userId, chosen), skipped: '' };
  } catch (error) {
    console.warn('[coden:proposals_failed]', { message: String((error as any)?.message || error).slice(0, 200) });
    return { proposed: [], skipped: 'error' };
  }
}
