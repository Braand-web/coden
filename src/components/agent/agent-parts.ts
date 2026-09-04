import type { ChatEvent, FileAction } from '../../lib/agent-chat-protocol';
export type TextPart = { id: string; type: 'text'; text: string; done: boolean };
export type ToolPart = { id: string; type: 'tool'; kind: 'read' | 'write'; verb: string; files: string[] };
export type AgentPart = TextPart | ToolPart;
export type AgentMessageState = {
  parts: AgentPart[]; activity: string | null; thinking: boolean;
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  error?: string; lastSequence?: number; runId?: string;
};
export const EMPTY_MESSAGE: AgentMessageState = { parts: [], activity: null, thinking: false, status: 'streaming' };
const VERBS = { read: 'A lu', search: 'A cherché', create: 'A créé', edit: 'A modifié', delete: 'A supprimé' };
export const verbFor = (action: FileAction) => VERBS[action];
export const toolPart = (id: string, action: FileAction, files: string[]): ToolPart => ({ id, type: 'tool', kind: action === 'read' || action === 'search' ? 'read' : 'write', verb: verbFor(action), files });
export function reduceAgentMessage(prev: AgentMessageState, event: ChatEvent, sequence?: number): AgentMessageState {
  if (sequence !== undefined && sequence <= (prev.lastSequence ?? -1)) return prev;
  if (prev.status !== 'streaming') return prev;
  const next = { ...prev, parts: [...prev.parts], lastSequence: sequence ?? prev.lastSequence };
  const closeText = () => { next.parts = next.parts.map(p => p.type === 'text' && !p.done ? { ...p, done: true } : p); };
  switch (event.type) {
    case 'run_started': next.thinking = true; break;
    case 'activity': closeText(); next.activity = event.label; next.thinking = true; break;
    case 'text_delta': {
      const last = next.parts.at(-1);
      if (last?.type === 'text' && !last.done) next.parts[next.parts.length - 1] = { ...last, text: last.text + event.delta };
      else next.parts.push({ id: `text-${next.parts.length}`, type: 'text', text: event.delta, done: false });
      next.thinking = false; next.activity = null; break;
    }
    case 'text_end': closeText(); break;
    case 'files_touched': closeText(); next.parts.push(toolPart(`tool-${next.parts.length}`, event.action, event.paths)); next.thinking = false; next.activity = null; break;
    case 'run_finished': closeText(); next.status = event.reason === 'cancelled' ? 'cancelled' : 'done'; next.thinking = false; next.activity = null; break;
    case 'run_failed': closeText(); next.status = 'error'; next.error = event.message; next.thinking = false; next.activity = null; break;
    case 'heartbeat': break;
  }
  return next;
}
