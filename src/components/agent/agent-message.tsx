import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Copy, FileText, RotateCcw } from 'lucide-react';
import { Response } from '../ui/response';
import { AgentThinkingLine } from './agent-thinking-line';
import { AgentToolLine } from './agent-tool-line';
import type { AgentMessageState, AgentNotice, DecisionNotice } from './agent-parts';
import '../../styles/agent-message.css';

function DecisionNoticeView({ notice, onSelect }: { notice: DecisionNotice; onSelect?: (decisionId: string, option: DecisionNotice['options'][number]) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <section className="coden-stream-notice coden-stream-decision" aria-label="Décision requise">
    <div className="coden-stream-notice-kicker"><span aria-hidden="true" />Décision requise</div>
    <h3>{notice.question}</h3>
    <div className="coden-stream-decision-options">
      {notice.options.map(option => <button key={option.id} type="button" disabled={Boolean(selected) || !onSelect} className={option.recommended ? 'is-recommended' : ''} onClick={() => { setSelected(option.id); onSelect?.(notice.id, option); }}>
        <span>{option.label}</span>
        {option.description ? <small>{option.description}</small> : null}
        {option.recommended ? <strong>Recommandé</strong> : null}
      </button>)}
    </div>
    {notice.allowFreeText ? <p className="coden-stream-notice-hint">Vous pouvez aussi répondre librement dans le composer.</p> : null}
  </section>;
}

function StreamNotice({ notice, onDecisionSelect, onArtifactOpen }: { notice: AgentNotice; onDecisionSelect?: (decisionId: string, option: DecisionNotice['options'][number]) => void; onArtifactOpen?: (artifactId: string) => void }) {
  if (notice.type === 'decision') return <DecisionNoticeView notice={notice} onSelect={onDecisionSelect} />;
  if (notice.type === 'artifact') return <section className="coden-stream-notice coden-stream-artifact"><div className="coden-stream-notice-kicker"><FileText size={14} aria-hidden="true" />{notice.artifactType}</div><h3>{notice.title}</h3><p>Version {notice.version}</p>{onArtifactOpen ? <button type="button" className="coden-stream-artifact-open" onClick={() => onArtifactOpen(notice.id)}>Ouvrir</button> : null}</section>;
  return <section className="coden-stream-notice coden-stream-cost"><div className="coden-stream-notice-kicker"><span aria-hidden="true" />Point de contrôle</div><h3>{notice.creditsUsed} crédits utilisés</h3><p>{notice.completed}</p><p>{notice.next}</p><dl><div><dt>Prochain seuil</dt><dd>{notice.nextThreshold}</dd></div>{notice.estimatedRemaining !== undefined ? <div><dt>Estimation restante</dt><dd>{notice.estimatedRemaining}</dd></div> : null}</dl></section>;
}

export function AgentMessage({ state, onCopy, onRetry, onDecisionSelect, onArtifactOpen }: { state: AgentMessageState; onCopy?: () => void; onRetry?: () => void; onDecisionSelect?: (decisionId: string, option: DecisionNotice['options'][number]) => void; onArtifactOpen?: (artifactId: string) => void }) {
  const streaming = state.status === 'streaming';
  return <section className="coden-agent-message" aria-busy={streaming} data-status={state.status}>
    {state.parts.map(part => part.type === 'text' ? <Response key={part.id} isStreaming={streaming && !part.done}>{part.text}</Response> : <AgentToolLine key={part.id} part={part} />)}
    {(state.notices || []).map(notice => <StreamNotice key={`${notice.type}-${notice.id}`} notice={notice} onDecisionSelect={onDecisionSelect} onArtifactOpen={onArtifactOpen} />)}
    {/*
      * Keyed on the label, not on the slot.
      *
      * The key was the constant 'activity', so React reused the same element
      * every time the run moved on — "prépare le plan" became "installe les
      * dépendances" became "construit l'application" with no mount and no
      * unmount, which meant `AnimatePresence` never saw a transition and the
      * text was swapped in place mid-shimmer. `mode="wait"` then holds the
      * outgoing phrase until it has finished leaving, so the two never overlap
      * on one line.
      */}
    <AnimatePresence mode="wait">
      {streaming && state.thinking
        ? <AgentThinkingLine key={state.activity || 'thinking'} label={state.activity} />
        : null}
    </AnimatePresence>
    {state.error ? <p role="alert" className="coden-agent-message-error">{state.error}</p> : null}
    {state.status === 'cancelled' ? <p className="coden-agent-message-note">Exécution annulée.</p> : null}
    {!streaming && (onCopy || onRetry) ? <div className="coden-message-actions">
      {onCopy ? <button type="button" aria-label="Copier" title="Copier" onClick={onCopy}><Copy size={15} aria-hidden="true" /></button> : null}
      {onRetry ? <button type="button" aria-label="Réessayer" title="Réessayer" onClick={onRetry}><RotateCcw size={15} aria-hidden="true" /></button> : null}
    </div> : null}
  </section>;
}
