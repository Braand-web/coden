import { useState } from 'react';
import './first-run-guide.css';
import { dismissGuide, FIRST_STEPS, FIRST_TIPS, guideDismissed } from '../lib/first-run';

/**
 * Under the dashboard composer, for someone with no project yet: three steps, what makes a good first request, and how
 * long it takes. It steps aside for good when dismissed, and is never shown to anyone who already has a project.
 */
export function FirstRunGuide({ projectCount, loading }: { projectCount: number; loading: boolean }) {
  const [hidden, setHidden] = useState(() => guideDismissed());
  if (loading || projectCount > 0 || hidden) return null;
  return (
    <section className="coden-firstrun" aria-labelledby="coden-firstrun-title">
      <div className="coden-firstrun-head">
        <h2 id="coden-firstrun-title">Votre première application, en trois étapes</h2>
        <button type="button" className="coden-firstrun-close" onClick={() => { dismissGuide(); setHidden(true); }} aria-label="Masquer ce guide">Masquer</button>
      </div>
      <ol className="coden-firstrun-steps">
        {FIRST_STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="coden-firstrun-num" aria-hidden="true">{index + 1}</span>
            <span><strong>{step.title}</strong><small>{step.text}</small></span>
          </li>
        ))}
      </ol>
      <ul className="coden-firstrun-tips" aria-label="Pour un bon premier résultat">
        {FIRST_TIPS.map(tip => <li key={tip}>{tip}</li>)}
      </ul>
    </section>
  );
}
