import React from 'react';
import { AlertTriangle, Check, ChevronDown, CircleDot, Copy, FileCode2, LoaderCircle, OctagonX, RotateCcw, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Response } from '../ui/response';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '../ai-elements/tool';
import { Source, Sources, SourcesContent, SourcesTrigger } from '../ai-elements/sources';
import { EASE_OUT, SPRING_LAYOUT, SPRING_PRESS } from '../../lib/ease';
import { cn } from '../../lib/utils';
import { modeLabel, runStatusLabel, type AgentMode, type AgentRunStatus } from '../../services/agent-run-contract';
import type { AgentRunViewModel } from '../../services/agent-run-store';

type AgentRunPanelProps = {
  view: AgentRunViewModel;
  streamText?: string;
  locale?: 'fr' | 'en';
  onCancel?: () => void;
  onRetry?: () => void;
  onBuildPlan?: () => void;
  onClarification?: (value: string) => void;
  tools?: Array<{ id: string; name: string; status: string; input?: unknown; output?: string; error?: string }>;
  sources?: Array<{ id: string; url: string; title?: string }>;
  attachments?: Array<{ id: string; name: string; url?: string; mediaType?: string }>;
};

function isActive(status: AgentRunStatus) {
  return ['submitting', 'understanding', 'clarifying', 'planning', 'executing', 'verifying'].includes(status);
}

function statusTone(status: AgentRunStatus) {
  if (status === 'completed') return 'success';
  if (status === 'needs_fix' || status === 'failed' || status === 'blocked') return 'danger';
  if (status === 'cancelled' || status === 'incomplete') return 'warning';
  return 'active';
}

function StatusIcon({ status }: { status: AgentRunStatus }) {
  if (status === 'completed') return <Check aria-hidden="true" size={15} />;
  if (status === 'failed' || status === 'needs_fix' || status === 'blocked') return <AlertTriangle aria-hidden="true" size={15} />;
  if (status === 'cancelled' || status === 'incomplete') return <OctagonX aria-hidden="true" size={15} />;
  if (isActive(status)) return <LoaderCircle aria-hidden="true" size={15} className="is-spinning" />;
  return <CircleDot aria-hidden="true" size={15} />;
}

export function AgentRunPanel({ view, streamText, locale = 'fr', onCancel, onRetry, onBuildPlan, onClarification, tools = [], sources = [], attachments = [] }: AgentRunPanelProps) {
  const reduced = useReducedMotion();
  const [technicalOpen, setTechnicalOpen] = React.useState(false);
  const [clarification, setClarification] = React.useState('');
  const content = streamText ?? view.assistantText;
  const showPlan = Boolean(view.plan);
  const showActivity = view.activities.length > 0;
  const active = isActive(view.status);
  const planReady = view.plan?.status === 'ready';

  const copyContent = () => {
    if (content) void navigator.clipboard?.writeText(content);
  };

  return (
    <motion.section
      className={cn('coden-agent-run-panel', `is-${statusTone(view.status)}`)}
      data-run-id={view.runId}
      data-run-status={view.status}
      aria-busy={active}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { duration: .24, ease: EASE_OUT }}
    >
      <header className="coden-agent-run-header">
        <div className="coden-agent-run-status" aria-live="polite">
          <StatusIcon status={view.status} />
          <span>{runStatusLabel(view.status, locale)}</span>
        </div>
        <div className="coden-agent-run-meta">
          <span className="coden-agent-mode-chip">{modeLabel(view.requestedMode as AgentMode, locale)}</span>
          {view.resolvedAction ? <span className="coden-agent-action-chip">{view.resolvedAction}</span> : null}
          {view.model && view.model !== 'unknown' ? <span className="coden-agent-model-chip">{view.model}</span> : null}
        </div>
        {active && onCancel ? (
          <button type="button" className="coden-agent-icon-action" onClick={onCancel} aria-label="Annuler le run" title="Annuler">
            <OctagonX aria-hidden="true" size={15} />
          </button>
        ) : null}
      </header>

      {view.objective ? (
        <section className="coden-agent-objective" aria-labelledby={`objective-${view.runId}`}>
          <div className="coden-agent-section-kicker"><ShieldCheck aria-hidden="true" size={14} /> Compréhension</div>
          <h3 id={`objective-${view.runId}`}>{view.objective.summary}</h3>
          {view.objective.requirements.length ? (
            <ul>{view.objective.requirements.slice(0, 6).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
          ) : null}
        </section>
      ) : null}

      {view.clarification ? (
        <section className="coden-agent-clarification" aria-label="Clarification requise">
          <strong>{view.clarification.question}</strong>
          {view.clarification.options?.length ? (
            <div className="coden-agent-choice-row">
              {view.clarification.options.map((option) => <button key={option} type="button" onClick={() => onClarification?.(option)}>{option}</button>)}
            </div>
          ) : null}
          <div className="coden-agent-clarification-form">
            <input value={clarification} onChange={(event) => setClarification(event.target.value)} placeholder="Votre réponse" aria-label="Réponse à la clarification" />
            <button type="button" disabled={!clarification.trim()} onClick={() => { onClarification?.(clarification.trim()); setClarification(''); }}>Continuer</button>
          </div>
        </section>
      ) : null}

      {showPlan ? (
        <section className="coden-agent-plan-card" aria-label="Plan du modèle">
          <div className="coden-agent-section-heading">
            <div><span className="coden-agent-section-kicker"><FileCode2 aria-hidden="true" size={14} /> Plan</span><h3>{view.plan?.title || 'Plan proposé'}</h3></div>
            <span className={cn('coden-agent-plan-state', `is-${view.plan?.status}`)}>{view.plan?.status === 'ready' ? 'Prêt' : view.plan?.status}</span>
          </div>
          {view.plan?.objective ? <p className="coden-agent-plan-objective">{view.plan.objective}</p> : null}
          <ol className="coden-agent-plan-steps">
            {view.plan?.steps.map((step) => <li key={step.id} data-step-status={step.state || 'pending'}><span className="coden-agent-step-marker">{step.state === 'done' ? <Check aria-hidden="true" size={12} /> : step.state === 'active' ? <LoaderCircle aria-hidden="true" size={12} className="is-spinning" /> : null}</span><span>{step.title}</span>{step.path ? <code>{step.path}</code> : null}</li>)}
          </ol>
          {planReady && onBuildPlan ? <button type="button" className="coden-agent-primary-action" onClick={onBuildPlan}>Construire ce plan</button> : null}
        </section>
      ) : null}

      {content ? (
        <section className="coden-agent-response" aria-label="Réponse de Coden">
          <Response>{content}</Response>
          {active ? <span className="coden-agent-response-caret" aria-hidden="true" /> : null}
          {!active && content ? <button type="button" className="coden-agent-copy-action" onClick={copyContent}><Copy aria-hidden="true" size={13} /> Copier</button> : null}
        </section>
      ) : active ? <div className="coden-agent-shimmer" aria-hidden="true"><span /><span /><span /></div> : null}

      {showActivity ? (
        <div className="coden-agent-activity-list" aria-label="Activité du run">
          {view.activities.slice(-8).map((item) => <div className={cn('coden-agent-activity-item', `is-${item.status}`)} key={item.id}><span className="coden-agent-activity-dot" aria-hidden="true" /><span>{item.label}</span>{item.detail ? <small>{item.detail}</small> : null}</div>)}
        </div>
      ) : null}

      {view.checks.length ? (
        <details className="coden-agent-verification-details">
          <summary><span>Vérifications</span><span>{view.checks.filter((check) => check.status === 'passed').length}/{view.checks.length}</span></summary>
          <div className="coden-agent-check-list">{view.checks.map((check) => <div className={cn('coden-agent-check', `is-${check.status}`)} key={check.id}><span>{check.status === 'passed' ? <Check size={13} /> : check.status === 'failed' ? <AlertTriangle size={13} /> : <CircleDot size={13} />}</span><span>{check.label}</span>{check.detail ? <small>{check.detail}</small> : null}</div>)}</div>
        </details>
      ) : null}

      {view.error ? <div className="coden-agent-error" role="alert"><AlertTriangle aria-hidden="true" size={15} /><span>{view.error}</span></div> : null}

      <details className="coden-agent-technical-details" open={technicalOpen} onToggle={(event) => setTechnicalOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary><ChevronDown aria-hidden="true" size={14} /> Détails techniques</summary>
        {tools.length ? <div className="coden-agent-tools-list">{tools.map((tool) => <Tool key={tool.id} defaultOpen={false}><ToolHeader name={tool.name} status={tool.status as never} /><ToolContent>{tool.input !== undefined ? <ToolInput input={tool.input} /> : null}{tool.output || tool.error ? <ToolOutput errorText={tool.error} output={tool.output ? <pre className="coden-tool-output-pre"><code>{tool.output}</code></pre> : null} /> : null}</ToolContent></Tool>)}</div> : null}
        {sources.length ? <Sources><SourcesTrigger count={sources.length} /><SourcesContent>{sources.map((source) => <Source key={source.id} href={source.url} title={source.title || source.url} />)}</SourcesContent></Sources> : null}
        {attachments.length ? <div className="coden-agent-attachments">{attachments.map((attachment) => attachment.url ? <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">{attachment.name}</a> : <span key={attachment.id}>{attachment.name}</span>)}</div> : null}
        <dl><div><dt>Run</dt><dd>{view.runId}</dd></div><div><dt>Modèle</dt><dd>{view.model}</dd></div><div><dt>Fichiers</dt><dd>{view.files.length}</dd></div><div><dt>Crédits</dt><dd>{view.creditPolicy}</dd></div></dl>
      </details>

      {!active && (view.status === 'failed' || view.status === 'needs_fix' || view.status === 'incomplete') && onRetry ? <button type="button" className="coden-agent-secondary-action" onClick={onRetry}><RotateCcw aria-hidden="true" size={14} /> Réessayer</button> : null}
    </motion.section>
  );
}
