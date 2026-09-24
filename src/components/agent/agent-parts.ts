import type { ChatEvent, DecisionQuestion, FileAction } from '../../lib/agent-chat-protocol';
import { normalizeDecisionQuestions } from '../../lib/decision-questions';
export type TextPart = { id: string; type: 'text'; text: string; done: boolean };
export type ToolPart = { id: string; type: 'tool'; kind: 'read' | 'write'; verb: string; files: string[] };
/** What the model reasoned before answering, folded by default. */
export type ReasoningPart = { id: string; type: 'reasoning'; text: string; done: boolean };
export type AgentPart = TextPart | ToolPart | ReasoningPart;
/** What Auto chose for this turn; the last entry is the model now working. */
export type AutoChoice = { modelId: string; label: string; reasoningLevel: string; reason?: 'initial' | 'escalation' | 'substitution' };
export type DecisionNotice = { type: 'decision'; id: string; question: string; options: Array<{ id: string; label: string; description?: string; recommended?: boolean }>; allowFreeText: boolean; questions?: DecisionQuestion[] };
export type ArtifactNotice = { type: 'artifact'; id: string; artifactType: 'plan' | 'report' | 'diff' | 'screenshot'; title: string; version: number };
export type CostNotice = { type: 'cost'; id: string; creditsUsed: number; nextThreshold: number; completed: string; next: string; estimatedRemaining?: number };
export type AgentNotice = DecisionNotice | ArtifactNotice | CostNotice;
export type AgentMessageState = {
  parts: AgentPart[]; activity: string | null; thinking: boolean;
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  error?: string; diagnosticCode?: string; lastSequence?: number; runId?: string; notices?: AgentNotice[]; pausedReason?: 'decision' | 'cost' | 'user' | 'provider';
  autoChoices?: AutoChoice[];
};
export const EMPTY_MESSAGE: AgentMessageState = { parts: [], activity: null, thinking: false, status: 'streaming', notices: [] };
const VERBS = { read: 'A lu', search: 'A cherché', create: 'A créé', edit: 'A modifié', delete: 'A supprimé' };
export const verbFor = (action: FileAction) => VERBS[action];
export const toolPart = (id: string, action: FileAction, files: string[]): ToolPart => ({ id, type: 'tool', kind: action === 'read' || action === 'search' ? 'read' : 'write', verb: verbFor(action), files });
export function reduceAgentMessage(prev: AgentMessageState, event: ChatEvent, sequence?: number): AgentMessageState {
  if (sequence !== undefined && sequence <= (prev.lastSequence ?? -1)) return prev;
  if (prev.status !== 'streaming') return prev;
  const next = { ...prev, parts: [...prev.parts], notices: [...(prev.notices || [])], lastSequence: sequence ?? prev.lastSequence };
  const closeText = () => { next.parts = next.parts.map(p => (p.type === 'text' || p.type === 'reasoning') && !p.done ? { ...p, done: true } : p); };
  switch (event.type) {
    case 'run_started': next.thinking = true; break;
    case 'activity': closeText(); next.activity = event.label; next.thinking = true; break;
    case 'reasoning_delta': {
      const last = next.parts.at(-1);
      const open = last?.type === 'reasoning' && !last.done;
      if (open) next.parts[next.parts.length - 1] = { ...last, text: last.text + event.delta };
      else {
        closeText();
        next.parts.push({ id: `reasoning-${next.parts.length}`, type: 'reasoning', text: event.delta, done: false });
      }
      // Still thinking: the shimmer stays until the answer itself starts.
      next.thinking = true;
      break;
    }
    case 'model_selected':
      next.autoChoices = [...(next.autoChoices || []), { modelId: event.modelId, label: event.label, reasoningLevel: event.reasoningLevel, reason: event.reason }];
      break;
    case 'text_delta': {
      const last = next.parts.at(-1);
      // The answer begins: the reasoning before it is complete.
      if (last?.type === 'reasoning' && !last.done) next.parts[next.parts.length - 1] = { ...last, done: true };
      const open = last?.type === 'text' && !last.done;
      const text = open ? last.text + event.delta : event.delta;
      if (open) next.parts[next.parts.length - 1] = { ...last, text };
      else next.parts.push({ id: `text-${next.parts.length}`, type: 'text', text, done: false });
      // A reply that opens with a line break has not said anything yet; the
      // thinking line stays until there is a character to look at, so the
      // message never goes blank between the two.
      if (text.trim()) { next.thinking = false; next.activity = null; }
      break;
    }
    case 'text_end': closeText(); break;
    /*
     * Touching a file is a step, not the end of the work.
     *
     * The run carries on after it — reading the next file, writing the next
     * one — and nothing is said until the following event. Turning the
     * thinking line off here left the reply silent for that whole stretch,
     * which reads as a stall. It stays lit, on the default label, until text
     * or a terminal event puts it away.
     */
    case 'files_touched': closeText(); next.parts.push(toolPart(`tool-${next.parts.length}`, event.action, event.paths)); next.thinking = true; next.activity = null; break;
    case 'run_finished': {
      closeText();
      /*
       * A run that stopped to ask keeps its question.
       *
       * Notices are cleared here because a finished run's decision and cost
       * checkpoints are stale — they belonged to work that is over. The one a
       * paused run is waiting on is the opposite: it is the reason the run
       * ended, and clearing it would erase the card a second before the person
       * could answer it, leaving a reply that simply stops.
       */
      const awaitingDecision = next.pausedReason === 'decision';
      next.status = event.reason === 'cancelled' ? 'cancelled' : 'done';
      next.thinking = false;
      next.activity = null;
      next.pausedReason = awaitingDecision ? 'decision' : undefined;
      next.notices = next.notices?.filter(notice => notice.type === 'artifact' || (awaitingDecision && notice.type === 'decision'));
      break;
    }
    case 'run_cancelled': closeText(); next.status = 'cancelled'; next.thinking = false; next.activity = null; break;
    /*
     * The code is kept beside the sentence, not instead of it.
     *
     * The server phrases the failure in the language it guessed from the
     * prompt, and the interface is French throughout — so an English-looking
     * prompt put an English sentence under a French heading. Keeping the
     * diagnostic lets the client say it itself; the server's own text stays as
     * the fallback for a failure that carries no code.
     */
    case 'run_failed': closeText(); next.status = 'error'; next.error = event.message; next.diagnosticCode = event.diagnosticCode; next.thinking = false; next.activity = null; break;
    case 'run_paused': closeText(); next.thinking = false; next.activity = null; next.pausedReason = event.reason; break;
    case 'run_resumed': next.thinking = true; next.pausedReason = undefined; next.notices = next.notices?.filter(notice => notice.type === 'artifact'); break;
    case 'decision_required': {
      closeText(); next.thinking = false; next.activity = null;
      /*
       * A questionnaire only exists once it is known to be usable.
       *
       * `questions` is optional and comes off the wire, so a malformed one —
       * a question with no options, an empty array — has to leave the notice
       * exactly as it was before questionnaires existed. Normalising to `[]`
       * here and dropping the field makes the single-question view the
       * fallback everywhere, rather than something each reader has to check.
       */
      const questions = normalizeDecisionQuestions(event.questions);
      const notice: DecisionNotice = { type: 'decision', id: event.decisionId, question: event.question, options: event.options, allowFreeText: event.allowFreeText };
      if (questions.length) notice.questions = questions;
      next.notices = [...(next.notices || []).filter(existing => existing.id !== event.decisionId), notice];
      break;
    }
    case 'artifact_ready': next.notices = [...(next.notices || []).filter(notice => notice.id !== event.artifactId), { type: 'artifact', id: event.artifactId, artifactType: event.artifactType, title: event.title, version: event.version }]; break;
    case 'cost_checkpoint': closeText(); next.thinking = false; next.activity = null; next.notices = [...(next.notices || []).filter(notice => notice.id !== event.checkpointId), { type: 'cost', id: event.checkpointId, creditsUsed: event.creditsUsed, nextThreshold: event.nextThreshold, completed: event.completed, next: event.next, estimatedRemaining: event.estimatedRemaining }]; break;
    case 'heartbeat': break;
  }
  return next;
}
