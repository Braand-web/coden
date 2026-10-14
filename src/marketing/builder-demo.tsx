import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentMessage } from '../components/agent/agent-message';
import { EMPTY_MESSAGE, reduceAgentMessage, type AgentMessageState } from '../components/agent/agent-parts';
import type { ChatEvent } from '../lib/agent-chat-protocol';

const answer = 'La page met en avant les plats de saison, clarifie la carte et facilite la réservation depuis un téléphone.';
const answerChunks = answer.match(/\S+\s*/g) || [answer];
const events: ChatEvent[] = [
  { type: 'run_started', messageId: 'landing-demo' },
  { type: 'activity', label: 'Analyse de la page et de sa structure' },
  { type: 'files_touched', action: 'edit', paths: ['src/App.tsx', 'src/styles.css'] },
  { type: 'activity', label: 'Préparation de l’aperçu' },
  ...answerChunks.map(delta => ({ type: 'text_delta', delta }) as ChatEvent),
  { type: 'text_end' },
  { type: 'run_finished', reason: 'completed' },
];

const emptyState = (): AgentMessageState => ({ ...EMPTY_MESSAGE, parts: [], notices: [] });

function finalState() {
  return events.reduce((state, event, index) => reduceAgentMessage(state, event, index + 1), emptyState());
}

function BuilderDemo() {
  const [message, setMessage] = useState<AgentMessageState>(emptyState);
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const sectionRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef<AgentMessageState>(emptyState());
  const [replay, setReplay] = useState(0);

  const reset = useCallback(() => {
    stateRef.current = emptyState();
    setMessage(stateRef.current);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let stopped = false;
    let running = false;
    let completed = false;
    let timer = 0;
    let sequence = 0;

    const finishWithoutAnimation = () => {
      window.clearTimeout(timer);
      running = false;
      completed = true;
      stateRef.current = finalState();
      setMessage(stateRef.current);
    };
    const start = () => {
      if (stopped || completed || running || !visible || document.hidden || reducedMotion.matches) return;
      running = true;
      sequence = 0;
      reset();
      const tick = () => {
        if (stopped || !visible || document.hidden || reducedMotion.matches) return;
        const event = events[sequence++];
        if (!event) { running = false; return; }
        stateRef.current = reduceAgentMessage(stateRef.current, event, sequence);
        setMessage(stateRef.current);
        if (event.type === 'run_finished') { running = false; completed = true; return; }
        timer = window.setTimeout(tick, event.type === 'text_delta' ? 82 : 620);
      };
      timer = window.setTimeout(tick, 350);
    };
    const update = () => {
      if (reducedMotion.matches) finishWithoutAnimation();
      else if (visible && !document.hidden) start();
      else { window.clearTimeout(timer); running = false; }
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      update();
    }, { threshold: 0.2 });
    observer.observe(section);
    document.addEventListener('visibilitychange', update);
    reducedMotion.addEventListener('change', update);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
      reducedMotion.removeEventListener('change', update);
    };
  }, [replay, reset]);

  const replayDemo = () => {
    reset();
    setReplay(value => value + 1);
  };

  return <div className="coden-builder-demo" ref={node => { sectionRef.current = node; }}>
    <header className="coden-builder-demo-toolbar">
      <span className="coden-builder-demo-brand"><img src="/favicon.svg" alt="" width="24" height="24" /> Builder</span>
      <span className="coden-builder-demo-project">Chez Marcel <span aria-hidden="true">·</span> Session de démonstration</span>
      <button className="coden-builder-demo-replay" type="button" onClick={replayDemo}>Relancer</button>
    </header>
    <div className="coden-builder-demo-workspace">
      <section className="coden-builder-demo-chat" aria-label="Conversation du Builder">
        <div className="coden-builder-demo-chat-heading"><span>Conversation</span><span className={`coden-builder-demo-live${message.status === 'done' ? ' is-ready' : ''}`} role="status"><i aria-hidden="true" />{message.status === 'done' ? 'Prêt' : 'Coden travaille'}</span></div>
        <div className="coden-builder-demo-thread">
          <article className="coden-builder-demo-user"><span className="coden-builder-demo-avatar" aria-hidden="true">B</span><div><small>Vous</small><p>Mets en avant les plats de saison et facilite la réservation sur mobile.</p></div></article>
          <article className="coden-builder-demo-agent"><span className="coden-builder-demo-avatar is-coden" aria-hidden="true"><img src="/favicon.svg" alt="" /></span><div className="coden-builder-demo-agent-content"><small>Coden</small><AgentMessage state={message} /></div></article>
        </div>
        <div className="coden-builder-demo-input" aria-label="Champ de message de démonstration"><span>Décrivez votre prochain changement</span><span aria-hidden="true">↑</span></div>
      </section>
      <section className="coden-builder-demo-preview" aria-label="Aperçu de l’application Chez Marcel">
        <header className="coden-builder-demo-preview-head"><div><span>Aperçu</span><strong>Chez Marcel · démonstration</strong></div><div className="coden-builder-demo-viewports" role="group" aria-label="Format de l’aperçu">
          <button type="button" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}>Bureau</button>
          <button type="button" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}>Mobile</button>
        </div></header>
        <div className={`coden-builder-demo-stage${viewport === 'mobile' ? ' is-mobile' : ''}`}>
          <iframe src="/projects/chez-marcel.html" title="Aperçu du site Chez Marcel" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerPolicy="no-referrer" />
        </div>
      </section>
    </div>
    <footer className="coden-builder-demo-foot"><span>Découvrez le Builder Coden en action.</span><span>Aucune génération ni aucun crédit consommé.</span></footer>
  </div>;
}

export function mountBuilderDemo() {
  const figure = document.querySelector<HTMLElement>('#exemples .lp-workspace');
  if (!figure || figure.dataset.builderMounted) return;
  figure.dataset.builderMounted = 'true';
  figure.removeAttribute('aria-labelledby');
  figure.setAttribute('aria-label', 'Démonstration du Builder Coden');
  const host = document.createElement('div');
  host.className = 'coden-builder-demo-host';
  figure.replaceChildren(host);
  createRoot(host).render(<BuilderDemo />);
}
