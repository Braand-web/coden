import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Copy, FileText, RotateCcw } from 'lucide-react';
import { Response } from '../ui/response';
import { AgentThinkingLine, THINKING_LABEL } from './agent-thinking-line';
import { AgentToolLine } from './agent-tool-line';
import AskCard from './ask-card';
import type { AgentMessageState, AgentNotice, DecisionNotice } from './agent-parts';
import type { DecisionAnswer, DecisionQuestion } from '../../lib/agent-chat-protocol';
import { getRuntimeRecoveryPresentation, publicRuntimeErrorMessage } from '../../lib/runtime-error-presentation';
import '../../styles/agent-message.css';

/*
 * What to say about a failure, and in which language.
 *
 * The interface is French throughout — the heading beside this, the cancelled
 * note, the decision card. The server, meanwhile, phrases its failures in the
 * language it guesses from the prompt, so a short or English-looking request
 * put an English sentence under a French heading.
 *
 * The diagnostic is the durable part of a failure, so the client phrases it
 * itself whenever there is one. The server's sentence stays as the fallback
 * for a failure that carries no code at all — which is what a connection cut
 * mid-stream produces.
 */
const UI_LOCALE = 'fr' as const;

function failureCopy(state: AgentMessageState): { title: string; body: string } {
  const code = state.diagnosticCode?.trim();
  if (code) {
    const recovery = getRuntimeRecoveryPresentation(code, UI_LOCALE);
    if (recovery) return recovery;
    return { title: 'La génération est interrompue', body: publicRuntimeErrorMessage(code, UI_LOCALE) };
  }
  return { title: 'La génération est interrompue', body: recoveryCopy(state.error || '') };
}

function recoveryCopy(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return 'La génération s’est interrompue. Votre travail enregistré reste disponible.';
  /*
   * Provider internals are for the logs. They are also the shape a message
   * takes when it was written for another audience — including the server's
   * English fallback, which must not land here verbatim.
   */
  if (/(request\s*id|\bcode\s*:|provider|quota|billing|rate.?limit|stack|digest method)/i.test(raw)) {
    return 'La génération est momentanément indisponible. Votre demande et les changements déjà enregistrés sont conservés.';
  }
  if (/^[\x00-\x7F]*$/.test(raw) && /\b(the|your|cannot|request|retry|kept)\b/i.test(raw)) {
    return 'La demande ne peut pas être terminée pour le moment. Votre travail est conservé et vous pouvez la relancer.';
  }
  return raw.slice(0, 280);
}

export type DecisionAnswersHandler = (decisionId: string, questions: DecisionQuestion[], answers: Record<number, DecisionAnswer>) => void;

function DecisionNoticeView({ notice, onSelect, onAnswers }: { notice: DecisionNotice; onSelect?: (decisionId: string, option: DecisionNotice['options'][number]) => void; onAnswers?: DecisionAnswersHandler }) {
  const [selected, setSelected] = useState<string | null>(null);
  /*
   * Several questions get the card; one keeps the notice.
   *
   * The card answers from a flat list of option labels, which is all a
   * questionnaire carries. A single decision carries more than that — a
   * description under each option and a recommendation — and folding it into
   * the card would throw both away to gain nothing.
   */
  const questions = notice.questions;
  if (questions?.length) {
    return <AskCard questions={questions} onSubmitted={onAnswers ? answers => onAnswers(notice.id, questions, answers) : undefined} />;
  }
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

function StreamNotice({ notice, onDecisionSelect, onDecisionAnswers, onArtifactOpen }: { notice: AgentNotice; onDecisionSelect?: (decisionId: string, option: DecisionNotice['options'][number]) => void; onDecisionAnswers?: DecisionAnswersHandler; onArtifactOpen?: (artifactId: string) => void }) {
  if (notice.type === 'decision') return <DecisionNoticeView notice={notice} onSelect={onDecisionSelect} onAnswers={onDecisionAnswers} />;
  if (notice.type === 'artifact') return <section className="coden-stream-notice coden-stream-artifact"><div className="coden-stream-notice-kicker"><FileText size={14} aria-hidden="true" />{notice.artifactType}</div><h3>{notice.title}</h3><p>Version {notice.version}</p>{onArtifactOpen ? <button type="button" className="coden-stream-artifact-open" onClick={() => onArtifactOpen(notice.id)}>Ouvrir</button> : null}</section>;
  return <section className="coden-stream-notice coden-stream-cost"><div className="coden-stream-notice-kicker"><span aria-hidden="true" />Point de contrôle</div><h3>{notice.creditsUsed} crédits utilisés</h3><p>{notice.completed}</p><p>{notice.next}</p><dl><div><dt>Prochain seuil</dt><dd>{notice.nextThreshold}</dd></div>{notice.estimatedRemaining !== undefined ? <div><dt>Estimation restante</dt><dd>{notice.estimatedRemaining}</dd></div> : null}</dl></section>;
}

export function AgentMessage({ state, onCopy, onRetry, onDecisionSelect, onDecisionAnswers, onArtifactOpen }: { state: AgentMessageState; onCopy?: () => void; onRetry?: () => void; onDecisionSelect?: (decisionId: string, option: DecisionNotice['options'][number]) => void; onDecisionAnswers?: DecisionAnswersHandler; onArtifactOpen?: (artifactId: string) => void }) {
  const streaming = state.status === 'streaming';
  /*
   * Keyed on the text, not on the slot and not on the raw activity.
   *
   * `state.activity || 'thinking'` meant the key flipped the moment the first
   * server label landed — including when that label is the very string already
   * on screen, which crossfaded the line into an identical copy of itself.
   */
  const thinkingLabel = state.activity?.trim() || THINKING_LABEL;
  return <section className="coden-agent-message" aria-busy={streaming} data-status={state.status}>
    {state.parts.map(part => part.type === 'text' ? <Response key={part.id} isStreaming={streaming && !part.done}>{part.text}</Response> : <AgentToolLine key={part.id} part={part} />)}
    {(state.notices || []).map(notice => <StreamNotice key={`${notice.type}-${notice.id}`} notice={notice} onDecisionSelect={onDecisionSelect} onDecisionAnswers={onDecisionAnswers} onArtifactOpen={onArtifactOpen} />)}
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
        ? <AgentThinkingLine key={thinkingLabel} label={thinkingLabel} />
        : null}
    </AnimatePresence>
    {/*
      * Drawn from the status, not from the text.
      *
      * The condition was `state.error`, and a run can fail with an empty
      * message — a dropped connection has nothing to say about itself. The
      * panel then rendered nothing at all: the reply simply stopped, with no
      * error, no explanation and no retry. A failed run is always visible now,
      * whether or not it managed to describe itself.
      */}
    {state.status === 'error' ? (() => {
      const failure = failureCopy(state);
      return (
        <section role="alert" className="coden-agent-message-error">
          <strong>{failure.title}</strong>
          <p>{failure.body}</p>
        </section>
      );
    })() : null}
    {/*
      * Waiting is not finishing.
      *
      * A run paused on a decision ends its stream like any other, so without
      * this the reply just stops above a card, and the difference between "the
      * agent is waiting for you" and "the agent died" is left for the user to
      * guess. It sits under the card because the card is the thing to act on.
      */}
    {state.pausedReason === 'decision' && state.status !== 'error' ? (
      <p className="coden-agent-message-waiting" role="status">Coden attend votre décision pour continuer. Votre travail est enregistré.</p>
    ) : null}
    {state.status === 'cancelled' ? <p className="coden-agent-message-note">Exécution annulée.</p> : null}
    {!streaming && (onCopy || onRetry) ? <div className="coden-message-actions">
      {onCopy ? <button type="button" aria-label="Copier" title="Copier" onClick={onCopy}><Copy size={15} aria-hidden="true" /></button> : null}
      {onRetry ? <button type="button" aria-label="Réessayer" title="Réessayer" onClick={onRetry}><RotateCcw size={15} aria-hidden="true" /></button> : null}
    </div> : null}
  </section>;
}
