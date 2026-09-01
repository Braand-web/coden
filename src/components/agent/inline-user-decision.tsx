import * as React from 'react';
import type { InlineUserDecision as InlineUserDecisionModel } from '../../services/agent-run-contract';

type Props = {
  decision: InlineUserDecisionModel;
  onSubmit?: (value: string) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
};

export function InlineUserDecision({ decision, onSubmit, onConfirm, onCancel }: Props) {
  const [value, setValue] = React.useState('');
  if (decision.type === 'clarification') {
    return (
      <div className="coden-inline-decision" aria-label="Clarification requise">
        <p>{decision.question}</p>
        {decision.choices?.length ? <div className="coden-inline-actions">{decision.choices.map((choice) => <button type="button" key={choice} onClick={() => onSubmit?.(choice)}>{choice}</button>)}</div> : null}
        <form onSubmit={(event) => { event.preventDefault(); const next = value.trim(); if (!next) return; onSubmit?.(next); setValue(''); }}>
          <input value={value} onChange={(event) => setValue(event.target.value)} aria-label="Votre réponse" placeholder="Votre réponse…" />
          <button type="submit" disabled={!value.trim()}>Continuer</button>
        </form>
      </div>
    );
  }
  if (decision.type === 'missing_integration') {
    return <div className="coden-inline-decision"><p>L’intégration {decision.integration} doit être connectée.</p><code>{decision.requiredEnvironmentVariables.join(', ')}</code><div className="coden-inline-actions"><button type="button" onClick={onConfirm}>Ajouter la configuration</button><button type="button" onClick={onCancel}>Annuler</button></div></div>;
  }
  return <div className="coden-inline-decision"><p>{decision.summary}</p><div className="coden-inline-actions"><button type="button" className="is-primary" onClick={onConfirm}>{decision.confirmLabel}</button><button type="button" onClick={onCancel}>{decision.cancelLabel}</button></div></div>;
}
