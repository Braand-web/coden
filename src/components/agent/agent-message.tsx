import { AnimatePresence } from 'motion/react';
import { Copy, RotateCcw } from 'lucide-react';
import { Response } from '../ui/response';
import { AgentThinkingLine } from './agent-thinking-line';
import { AgentToolLine } from './agent-tool-line';
import type { AgentMessageState } from './agent-parts';
import '../../styles/agent-message.css';
export function AgentMessage({ state, onCopy, onRetry }: { state: AgentMessageState; onCopy?: () => void; onRetry?: () => void }) {
  const streaming = state.status === 'streaming';
  return <section className="coden-agent-message" aria-busy={streaming} data-status={state.status}>
    {state.parts.map(part => part.type === 'text' ? <Response key={part.id} isStreaming={streaming && !part.done}>{part.text}</Response> : <AgentToolLine key={part.id} part={part} />)}
    <AnimatePresence>{streaming && state.thinking ? <AgentThinkingLine key="activity" label={state.activity} /> : null}</AnimatePresence>
    {state.error ? <p role="alert" className="coden-agent-message-error">{state.error}</p> : null}
    {state.status === 'cancelled' ? <p className="coden-agent-message-note">Exécution annulée.</p> : null}
    {!streaming && (onCopy || onRetry) ? <div className="coden-message-actions">
      {onCopy ? <button type="button" aria-label="Copier" title="Copier" onClick={onCopy}><Copy size={15} aria-hidden="true" /></button> : null}
      {onRetry ? <button type="button" aria-label="Réessayer" title="Réessayer" onClick={onRetry}><RotateCcw size={15} aria-hidden="true" /></button> : null}
    </div> : null}
  </section>;
}
