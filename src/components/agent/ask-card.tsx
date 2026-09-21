import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import GlideMenu from '../ui/glide-menu';
import type { DecisionAnswer, DecisionQuestion } from '../../lib/agent-chat-protocol';
import '../../styles/ask-card.css';

/*
 * The agent asking several things at once, and waiting.
 *
 * `decision_required` has always carried one question, so an agent needing
 * three answers stopped three times and paid a round trip between each. This
 * asks them together: one question visible at a time, the stack sliding
 * vertically as the card's height animates to fit, single-choice answers
 * advancing by themselves and multi-select waiting.
 *
 * Ported onto Coden's tokens — the original was written against another
 * design system's vocabulary (`bg-surface`, `text-ink`, `rounded-control`),
 * none of which exists here.
 *
 * Named for asking rather than for approving, because `.coden-approval-card`
 * is already the harness's approve/reject block in the conversation island:
 * keeping the original name would have had one component's stylesheet
 * silently restyle the other.
 */

export type AskCardLabels = {
  skip: string;
  continue: string;
  send: string;
  customPlaceholder: string;
  sentMessage: string;
};

const DEFAULT_LABELS: AskCardLabels = {
  skip: 'Passer',
  continue: 'Continuer',
  send: 'Envoyer',
  customPlaceholder: 'Autre chose…',
  sentMessage: 'Réponses envoyées',
};

const ROLL_MS = 400;
const SLIDE = '360ms cubic-bezier(0.22, 1, 0.36, 1)';
const AUTO_ADVANCE_MS = 480;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Digits that roll when they change.
 *
 * Keyed on the character position, and only the positions that actually differ
 * animate. The original compared `oldVal[i]` with `newVal[i]` across strings of
 * different lengths, so "9 / 10" becoming "10 / 10" shifted every character by
 * one and the whole counter garbled — reachable at ten questions. Both strings
 * are padded to the same width before they are compared.
 */
function RollingDigits({ value }: { value: string }) {
  const previous = useRef(value);
  const [from, setFrom] = useState(value);
  const [to, setTo] = useState(value);
  const [rolling, setRolling] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [direction, setDirection] = useState<'up' | 'down'>('up');

  useEffect(() => {
    if (previous.current === value) return;
    const start = previous.current;
    previous.current = value;
    if (prefersReducedMotion()) {
      setFrom(value);
      setTo(value);
      return;
    }
    const startNumber = parseInt(start, 10);
    const endNumber = parseInt(value, 10);
    setDirection(Number.isFinite(startNumber) && Number.isFinite(endNumber) && endNumber < startNumber ? 'down' : 'up');
    setFrom(start);
    setTo(value);
    setRolling(true);
    setShifted(false);

    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setShifted(true)); });
    const settle = setTimeout(() => { setRolling(false); setFrom(value); setShifted(false); }, ROLL_MS);
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); clearTimeout(settle); };
  }, [value]);

  const width = Math.max(from.length, to.length);
  const previousPadded = from.padStart(width, ' ');
  const currentPadded = (rolling ? to : from).padStart(width, ' ');

  return (
    <>
      {Array.from({ length: width }, (_, index) => {
        const before = previousPadded[index] ?? '';
        const after = currentPadded[index] ?? '';
        if (!rolling || before === after) return <span key={`${index}-${after}`}>{after}</span>;
        const top = direction === 'down' ? after : before;
        const bottom = direction === 'down' ? before : after;
        const rest = direction === 'down' ? '0' : '-1em';
        const start = direction === 'down' ? '-1em' : '0';
        return (
          <span key={`${index}-${before}-${after}-${direction}`} className="coden-ask-roll">
            <span className="coden-ask-roll-track" style={{ transform: `translateY(${shifted ? rest : start})` }}>
              <span>{top}</span>
              <span>{bottom}</span>
            </span>
          </span>
        );
      })}
    </>
  );
}

function Ico({ path, size = 14, width = 2 }: { path: ReactNode; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path}
    </svg>
  );
}

export default function AskCard({
  questions,
  labels,
  onSubmitted,
  onDismiss,
}: {
  questions: DecisionQuestion[];
  labels?: Partial<AskCardLabels>;
  /** Every answer, including free text. Called once. */
  onSubmitted?: (answers: Record<number, DecisionAnswer>) => void;
  onDismiss?: () => void;
}) {
  const t = { ...DEFAULT_LABELS, ...labels };
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<number, number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);

  /*
   * The answers as they stand right now, for anything that reads them outside
   * a render.
   *
   * `send` used to read `selected` from the render that created it, and the
   * auto-advance timer held that `send` for 480ms — so choosing an option on
   * the last question submitted the answers from *before* that choice, and the
   * final answer was dropped. A ref is the value at the moment it is read.
   */
  const live = useRef({ selected, custom });
  live.current = { selected, custom };

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const measured = useRef(false);
  const [viewportHeight, setViewportHeight] = useState<number | undefined>(undefined);
  const [trackY, setTrackY] = useState(0);
  const [animate, setAnimate] = useState(false);
  // Until the first measurement, only the active question is mounted, so the
  // card opens at its real height instead of flashing to the full stack.
  const [ready, setReady] = useState(false);

  const isLast = index === questions.length - 1;
  const picked = selected[index] ?? [];
  const hasAnswer = picked.length > 0 || Boolean(custom[index]?.trim());

  const sync = (withAnimation: boolean) => {
    const item = questionRefs.current[index];
    if (!item) return;
    setViewportHeight(item.offsetHeight);
    setTrackY(item.offsetTop);
    setAnimate(withAnimation && !prefersReducedMotion());
  };

  /*
   * Re-measured when the question changes, not on every keystroke.
   *
   * `custom` used to be a dependency, so typing a free-text answer re-ran this
   * per character with `animate` true — a 360ms height transition for every
   * letter. The height of a question does not change as it is typed into.
   */
  useLayoutEffect(() => {
    const withAnimation = measured.current;
    measured.current = true;
    sync(withAnimation);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, selected, questions.length, sent]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => sync(measured.current));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const goTo = (next: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setIndex(Math.min(Math.max(next, 0), questions.length - 1));
  };

  /*
   * Submit what is answered now, free text included.
   *
   * The original handed back `Record<number, number[]>` — option indices only
   * — so everything typed into the custom field gated the Continue button and
   * was then silently discarded.
   */
  const send = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (sent) return;
    setSent(true);
    const current = live.current;
    const answers: Record<number, DecisionAnswer> = {};
    questions.forEach((_, questionIndex) => {
      const chosen = current.selected[questionIndex] ?? [];
      const typed = current.custom[questionIndex]?.trim() || '';
      if (!chosen.length && !typed) return;
      answers[questionIndex] = typed ? { selected: chosen, custom: typed } : { selected: chosen };
    });
    onSubmitted?.(answers);
  };

  const advance = () => { if (isLast) send(); else goTo(index + 1); };

  const toggle = (option: number) => {
    const type = questions[index].type;
    setSelected(current => {
      const already = current[index] ?? [];
      const next = type === 'radio'
        ? [option]
        : already.includes(option) ? already.filter(item => item !== option) : [...already, option];
      const updated = { ...current, [index]: next };
      live.current = { ...live.current, selected: updated };
      return updated;
    });
    if (type !== 'radio') return;
    setCustom(current => {
      const updated = { ...current, [index]: '' };
      live.current = { ...live.current, custom: updated };
      return updated;
    });
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      if (isLast) send();
      else setIndex(current => Math.min(questions.length - 1, current + 1));
    }, AUTO_ADVANCE_MS);
  };

  if (!questions.length) return null;

  if (sent) {
    return (
      <div className="coden-ask-sent" role="status">
        <span className="coden-ask-sent-badge">
          <span className="coden-ask-sent-check">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          </span>
          {t.sentMessage}
        </span>
      </div>
    );
  }

  return (
    <section className="coden-ask-card" aria-label={questions[index]?.q}>
      {onDismiss ? (
        <button type="button" aria-label="Fermer" onClick={onDismiss} className="coden-ask-dismiss">
          <Ico size={14} width={2.2} path={<path d="M18 6L6 18M6 6l12 12" />} />
        </button>
      ) : null}

      <div
        className="coden-ask-viewport"
        style={{ height: viewportHeight, transition: animate ? `height ${SLIDE}` : undefined }}
        aria-live="polite"
      >
        <div
          className="coden-ask-track"
          style={{ transform: `translate3d(0, ${-trackY}px, 0)`, transition: animate ? `transform ${SLIDE}` : undefined }}
        >
          {questions.map((question, questionIndex) => {
            const active = questionIndex === index;
            if (!ready && !active) return null;
            const chosen = selected[questionIndex] ?? [];
            const style: CSSProperties = {
              opacity: active ? 1 : 0,
              transition: animate ? `opacity ${SLIDE}` : undefined,
              pointerEvents: active ? undefined : 'none',
            };
            return (
              <div
                key={questionIndex}
                ref={element => { questionRefs.current[questionIndex] = element; }}
                aria-hidden={active ? undefined : true}
                style={style}
              >
                <p className="coden-ask-question">{question.q}</p>
                {/*
                  * `radiogroup` rather than a row of toggle buttons.
                  * `aria-pressed` describes a button that stays down; a
                  * screen reader reading three independent pressed buttons
                  * cannot tell that choosing one releases the others.
                  */}
                <GlideMenu
                  className="coden-ask-options"
                  highlightClassName="coden-ask-highlight"
                >
                  <div role={question.type === 'radio' ? 'radiogroup' : 'group'} aria-label={question.q} className="coden-ask-option-list">
                    {question.options.map((option, optionIndex) => {
                      const on = chosen.includes(optionIndex);
                      return (
                        <button
                          key={option}
                          type="button"
                          data-menu-row
                          role={question.type === 'radio' ? 'radio' : 'checkbox'}
                          aria-checked={on}
                          tabIndex={active ? 0 : -1}
                          onClick={() => { if (active) toggle(optionIndex); }}
                          className="coden-ask-option"
                        >
                          <span className={`coden-ask-mark${on ? ' is-on' : ''} is-${question.type}`}>
                            {question.type === 'radio'
                              ? <span className="coden-ask-dot" style={{ transform: on ? 'scale(1)' : 'scale(0)' }} />
                              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                          </span>
                          <span className={`coden-ask-option-label${on ? ' is-on' : ''}`}>{option}</span>
                        </button>
                      );
                    })}
                  </div>
                  <label data-menu-row className="coden-ask-custom">
                    <input
                      value={custom[questionIndex] ?? ''}
                      tabIndex={active ? 0 : -1}
                      onChange={event => {
                        if (!active) return;
                        const value = event.target.value;
                        setCustom(current => {
                          const updated = { ...current, [questionIndex]: value };
                          live.current = { ...live.current, custom: updated };
                          return updated;
                        });
                        if (question.type === 'radio') {
                          setSelected(current => {
                            /*
                             * Clearing nothing has to be a no-op.
                             *
                             * A fresh object on every keystroke is a new
                             * `selected` identity, which the layout effect
                             * depends on — so typing re-measured the card
                             * per character even after `custom` was taken
                             * out of its dependencies. Returning the same
                             * reference means React sees no change at all.
                             */
                            if (!(current[questionIndex] ?? []).length) return current;
                            const updated = { ...current, [questionIndex]: [] };
                            live.current = { ...live.current, selected: updated };
                            return updated;
                          });
                        }
                      }}
                      onKeyDown={event => {
                        if (!active || event.key !== 'Enter' || !hasAnswer) return;
                        event.preventDefault();
                        advance();
                      }}
                      placeholder={t.customPlaceholder}
                      aria-label="Réponse libre"
                      className="coden-ask-custom-input"
                    />
                  </label>
                </GlideMenu>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="coden-ask-footer">
        <div className="coden-ask-steps">
          <button type="button" aria-label="Question précédente" disabled={index <= 0} onClick={() => goTo(index - 1)} className="coden-ask-step">
            <Ico size={14} path={<path d="M18 15l-6-6-6 6" />} />
          </button>
          <span className="coden-ask-counter">
            <RollingDigits value={`${index + 1} / ${questions.length}`} />
          </span>
          <button type="button" aria-label="Question suivante" disabled={isLast} onClick={() => goTo(index + 1)} className="coden-ask-step">
            <Ico size={14} path={<path d="M6 9l6 6 6-6" />} />
          </button>
        </div>
        <div className="coden-ask-actions">
          <button type="button" className="coden-ask-skip" onClick={() => (isLast ? send() : goTo(index + 1))}>
            {t.skip}
          </button>
          <button type="button" className="coden-ask-continue" disabled={!hasAnswer} onClick={advance}>
            {isLast ? t.send : t.continue}
          </button>
        </div>
      </footer>
    </section>
  );
}
