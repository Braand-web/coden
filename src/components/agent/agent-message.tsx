import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Check, ChevronRight, Copy, FileText, LayoutGrid, Plug, RotateCcw } from 'lucide-react';
import { CodenLogoMark } from '../brand/coden-logo';
import { localConnectorLogo } from '../../lib/connector-logos';
import { Response } from '../ui/response';
import { AgentThinkingLine, THINKING_LABEL } from './agent-thinking-line';
import { AgentToolLine } from './agent-tool-line';
import AskCard from './ask-card';
import type { AgentMessageState, AgentNotice, AutoChoice, DecisionNotice, ReasoningPart } from './agent-parts';
import type { ConnectionChoice, DecisionAnswer, DecisionQuestion, SubagentSnapshot } from '../../lib/agent-chat-protocol';
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
    // The app was built; only some checks are still open. Not an interruption.
    if (/^VERIFICATION_INCOMPLETE$/i.test(code)) return { title: 'Vérification à compléter', body: publicRuntimeErrorMessage(code, UI_LOCALE) };
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

const REASONING_LEVEL_LABELS: Record<string, string> = { none: 'Aucun', low: 'Bas', medium: 'Moyen', high: 'Élevé', max: 'Maximum' };

/**
 * The model's reasoning, folded.
 *
 * Open while it streams so the thinking is visible as it happens; a finished
 * block stays closed unless someone asks for it, so the answer leads.
 */
function ReasoningBlock({ part, streaming }: { part: ReasoningPart; streaming: boolean }) {
  const live = streaming && !part.done;
  return <details className="coden-agent-reasoning" open={live || undefined} data-live={live || undefined}>
    <summary><ChevronRight size={13} aria-hidden="true" className="coden-agent-reasoning-chevron" />{live ? 'Raisonnement en cours…' : 'Raisonnement'}</summary>
    <div className="coden-agent-reasoning-body">{part.text.trim()}</div>
  </details>;
}

/** Which model Auto is using, in one quiet line. */
function AutoChoiceLine({ choices }: { choices: AutoChoice[] }) {
  const current = choices.at(-1);
  if (!current) return null;
  const level = REASONING_LEVEL_LABELS[current.reasoningLevel] || current.reasoningLevel;
  // The chosen model refused the request mid-run and Coden carried on with a
  // compatible one: said once, quietly, instead of stopping on an error.
  if (current.reason === 'substitution') {
    return <p className="coden-agent-auto-choice">Relais · {current.label} · le modèle choisi a refusé cette étape</p>;
  }
  const escalated = choices.length > 1;
  return <p className="coden-agent-auto-choice" title={escalated ? choices.map(choice => choice.label).join(' → ') : undefined}>
    Auto · {current.label} · raisonnement {level.toLowerCase()}{escalated ? ' · renforcé' : ''}
  </p>;
}

const SUBAGENT_STATUS: Record<SubagentSnapshot['status'], string> = {
  queued: 'En attente',
  running: 'En cours',
  retrying: 'Relancé sur un modèle plus puissant',
  done: 'Terminé',
  failed: 'Échec',
};

/**
 * The sub-agents the master is running: role, status, progress, model.
 * One row each, updated live; the master's own reply follows below.
 */
export function SubagentsPanel({ agents }: { agents: SubagentSnapshot[] }) {
  if (!agents.length) return null;
  const finished = agents.filter(agent => agent.status === 'done' || agent.status === 'failed').length;
  return <section className="coden-subagents" aria-label="Sous-agents">
    <header>
      <strong>Sous-agents</strong>
      <span>{finished === agents.length ? `${agents.length} terminé${agents.length > 1 ? 's' : ''}` : `${agents.length - finished} actif${agents.length - finished > 1 ? 's' : ''} sur ${agents.length}`}</span>
    </header>
    <ul>
      {agents.map(agent => <li key={agent.id} data-status={agent.status} title={agent.error || agent.summary || agent.scope.join(', ')}>
        <span className="coden-subagent-dot" aria-hidden="true" />
        <span className="coden-subagent-main">
          <span className="coden-subagent-role">{agent.role}</span>
          <span className="coden-subagent-meta">{SUBAGENT_STATUS[agent.status]}{agent.model ? ` · ${agent.model}` : ''}{agent.status === 'failed' && agent.error ? ` · ${agent.error}` : ''}</span>
        </span>
        <span className="coden-subagent-bar" role="progressbar" aria-label={`Progression de ${agent.role}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(agent.progress * 100)}>
          <span style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, agent.progress))})` }} />
        </span>
      </li>)}
    </ul>
  </section>;
}

export type DecisionAnswersHandler = (decisionId: string, questions: DecisionQuestion[], answers: Record<number, DecisionAnswer>) => void;

/** What the host did with a connection choice. */
export type ConnectionOutcome = { status: 'connected' | 'provisioned' | 'cancelled' | 'failed'; message?: string };
/**
 * Sent on window when a connection option is picked; the Builder performs the
 * connection (Composio popup, Coden Cloud provisioning, catalogue) and calls
 * `resolve`. Unhandled, the card answers with the plain choice.
 */
export type ConnectionChoiceEventDetail = { decisionId: string; need: string; label: string; choice: ConnectionChoice; handled: boolean; resolve: (outcome: ConnectionOutcome) => void };

/** The brand on each connection button: Coden's mark, the service's logo, or the catalogue. */
function ConnectionChoiceLogo({ choice }: { choice: ConnectionChoice }) {
  const [failed, setFailed] = useState(false);
  if (choice.kind === 'coden_cloud') return <span className="coden-connection-logo is-brand"><CodenLogoMark /></span>;
  const src = choice.kind === 'toolkit' && choice.toolkit ? localConnectorLogo(choice.toolkit) : '';
  if (src && !failed) return <span className="coden-connection-logo"><img src={src} alt="" onError={() => setFailed(true)} /></span>;
  return <span className="coden-connection-logo is-icon"><LayoutGrid size={14} aria-hidden="true" /></span>;
}

/*
 * The app needs a service: one button per way to get it.
 *
 * Picking one does the connecting — Composio's page, Coden Cloud, or the
 * catalogue — and only then answers the waiting run, with what actually
 * happened, so it resumes on a connected service or, if the person backed
 * out, proposes an alternative instead of pretending.
 */
function ConnectionRequestCard({ decisionId, question, onAnswers }: { decisionId: string; question: DecisionQuestion; onAnswers?: DecisionAnswersHandler }) {
  const [phase, setPhase] = useState<{ state: 'idle' | 'working' | 'done' | 'failed'; index?: number; text?: string }>({ state: 'idle' });
  const connect = question.connect!;
  const answer = (selected: number[], custom: string) => onAnswers?.(decisionId, [question], { 0: { selected, custom } });

  const choose = (index: number) => {
    const choice = connect.choices[index];
    const label = question.options[index];
    setPhase({ state: 'working', index, text: choice.kind === 'coden_cloud' ? 'Préparation de Coden Cloud…' : choice.kind === 'toolkit' ? `Connexion à ${label}…` : 'Choisissez un service dans les intégrations…' });
    const detail: ConnectionChoiceEventDetail = {
      decisionId, need: connect.need, label, choice, handled: false,
      resolve: outcome => {
        if (outcome.status === 'connected' || outcome.status === 'provisioned') {
          const name = outcome.message || label;
          setPhase({ state: 'done', index, text: outcome.status === 'provisioned' ? 'Coden Cloud est prêt. Coden reprend le travail.' : `${name} est connecté. Coden reprend le travail.` });
          answer([index], outcome.status === 'provisioned'
            ? 'Coden Cloud est provisionné pour ce projet : utilise son backend (base de données, auth, stockage) et reprends la tâche.'
            : `${name} est maintenant connecté via Composio. Utilise-le pour de vrai (list_integration_tools puis run_integration_tool) et reprends la tâche.`);
          return;
        }
        if (outcome.status === 'cancelled') {
          setPhase({ state: 'idle' });
          return;
        }
        setPhase({ state: 'failed', index, text: outcome.message || 'La connexion n’a pas abouti. Réessayez ou choisissez une autre option.' });
      },
    };
    window.dispatchEvent(new CustomEvent('coden:connection-choice', { detail }));
    if (!detail.handled) {
      setPhase({ state: 'done', index, text: 'Choix envoyé.' });
      answer([index], '');
    }
  };

  const later = () => {
    setPhase({ state: 'done', text: 'Connexion reportée. Coden propose une alternative.' });
    answer([], 'Je ne connecte pas de service pour l’instant. Propose une alternative qui fonctionne sans (par exemple Coden Cloud, ou une version sans ce besoin) ou mets la tâche en pause proprement — ne simule pas le service.');
  };

  const busy = phase.state === 'working' || phase.state === 'done';
  return <section className="coden-connection-card" aria-label="Connexion requise" data-state={phase.state}>
    <div className="coden-connection-kicker"><Plug size={13} aria-hidden="true" />Connexion requise</div>
    <h3>{question.q}</h3>
    <div className="coden-connection-options">
      {question.options.map((label, index) => <button key={label} type="button" disabled={busy || !onAnswers} data-selected={phase.index === index || undefined} onClick={() => choose(index)}>
        <ConnectionChoiceLogo choice={connect.choices[index]} />
        <span>{label}</span>
        {phase.state === 'done' && phase.index === index ? <Check size={14} aria-hidden="true" /> : null}
        {phase.state === 'working' && phase.index === index ? <span className="coden-connection-spinner" aria-hidden="true" /> : null}
      </button>)}
    </div>
    {phase.text ? <p className="coden-connection-status" role="status">{phase.text}</p> : null}
    {!busy && onAnswers ? <button type="button" className="coden-connection-later" onClick={later}>Plus tard</button> : null}
  </section>;
}

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
  if (questions?.length === 1 && questions[0].connect) {
    return <ConnectionRequestCard decisionId={notice.id} question={questions[0]} onAnswers={onAnswers} />;
  }
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
    {state.autoChoices?.length ? <AutoChoiceLine choices={state.autoChoices} /> : null}
    {state.subagents?.length ? <SubagentsPanel agents={state.subagents} /> : null}
    {state.parts.map(part => part.type === 'text'
      ? <Response key={part.id} isStreaming={streaming && !part.done}>{part.text}</Response>
      : part.type === 'reasoning'
        ? <ReasoningBlock key={part.id} part={part} streaming={streaming} />
        : <AgentToolLine key={part.id} part={part} />)}
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
