import { RotateCcw, Square } from 'lucide-react';
import { AgentSteps } from './agent-steps';
import { AgentStream } from './agent-stream';
import { AgentProgressNote } from './agent-progress-note';
import { InlineUserDecision } from './inline-user-decision';
import type { AgentRunStatus } from '../../services/agent-run-contract';
import type { AgentRunViewModel } from '../../services/agent-run-store';
import '../../styles/agent-conversation.css';

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

function planAsMarkdown(view: AgentRunViewModel, locale: 'fr' | 'en') {
  if (!view.plan) return '';
  const title = view.plan.title || (locale === 'fr' ? 'Plan proposé' : 'Proposed plan');
  const steps = view.plan.steps.map((step, index) => `${index + 1}. ${step.title}${step.path ? ` — \`${step.path}\`` : ''}`).join('\n');
  const criteria = view.plan.acceptanceCriteria?.length
    ? `\n\n### ${locale === 'fr' ? 'Critères de validation' : 'Acceptance criteria'}\n\n${view.plan.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`
    : '';
  return `## ${title}\n\n${view.plan.objective ? `${view.plan.objective}\n\n` : ''}${steps}${criteria}`;
}

export function AgentRunPanel({
  view,
  streamText,
  locale = 'fr',
  onCancel,
  onRetry,
  onBuildPlan,
  onClarification,
}: AgentRunPanelProps) {
  const active = isActive(view.status);
  const content = streamText ?? view.assistantText;
  const activity = view.publicActivity;
  const showActivity = Boolean(activity && active && activity.active && (!content || activity.sequence > view.lastAssistantSequence));
  const responseContent = content || view.error || (!active ? planAsMarkdown(view, locale) : '');
  const streamingResponse = active && Boolean(content) && !view.hasFinal;
  const decision = view.decision || (view.clarification
    ? { type: 'clarification' as const, question: view.clarification.question, choices: view.clarification.options }
    : view.plan?.status === 'ready' && onBuildPlan
      ? {
          type: 'confirmation' as const,
          action: 'build_plan',
          summary: locale === 'fr' ? 'Le plan est prêt. Confirmez avant toute modification des fichiers.' : 'The plan is ready. Confirm before any file changes.',
          confirmLabel: locale === 'fr' ? 'Construire ce plan' : 'Build this plan',
          cancelLabel: locale === 'fr' ? 'Plus tard' : 'Later',
        }
      : undefined);

  return (
    <section className="coden-agent-conversation-run" data-run-id={view.runId} data-run-status={view.status} aria-busy={active}>
      {view.progressNotes.length ? (
        <div className="coden-agent-progress-list" aria-label={locale === 'fr' ? 'Progression de Coden' : 'Coden progress'}>
          {view.progressNotes.map((note) => <AgentProgressNote key={note.id} note={note} />)}
        </div>
      ) : null}
      <AgentSteps activities={view.activities} locale={locale} />
      <AgentStream runId={view.runId} activity={activity} showActivity={showActivity} content={responseContent} streaming={streamingResponse} />
      {decision ? <InlineUserDecision decision={decision} onSubmit={onClarification} onConfirm={onBuildPlan} onCancel={onCancel} /> : null}
      <div className="coden-agent-compact-actions">
        {active && onCancel ? <button type="button" onClick={onCancel}><Square aria-hidden="true" size={12} />{locale === 'fr' ? 'Arrêter' : 'Stop'}</button> : null}
        {!active && (view.status === 'failed' || view.status === 'needs_fix' || view.status === 'incomplete') && onRetry ? <button type="button" onClick={onRetry}><RotateCcw aria-hidden="true" size={13} />{locale === 'fr' ? 'Réessayer' : 'Retry'}</button> : null}
      </div>
    </section>
  );
}
