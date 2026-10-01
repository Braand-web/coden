import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Question } from '../questions';

export const SECONDS = 15;
export type Result = { question: Question; picked: number | null };

export function Quiz({ questions, onFinish }: { questions: Question[]; onFinish: (results: Result[]) => void }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [left, setLeft] = useState(SECONDS);
  const results = useRef<Result[]>([]);
  const question = questions[index];

  const reveal = useCallback((choice: number | null) => {
    setPicked(choice);
    setRevealed(true);
    results.current[index] = { question, picked: choice };
  }, [index, question]);

  // Le chrono s'arrête dès que la réponse est donnée ; à zéro, la question compte comme manquée.
  useEffect(() => {
    if (revealed) return;
    if (left <= 0) { reveal(null); return; }
    const timer = window.setTimeout(() => setLeft(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left, revealed, reveal]);

  const next = useCallback(() => {
    if (index + 1 >= questions.length) { onFinish(results.current); return; }
    setIndex(value => value + 1);
    setPicked(null);
    setRevealed(false);
    setLeft(SECONDS);
  }, [index, questions.length, onFinish]);

  // Clavier : 1 à 4 pour répondre, Entrée pour continuer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (!revealed && /^[1-4]$/.test(event.key)) reveal(Number(event.key) - 1);
      else if (revealed && event.key === 'Enter') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, reveal, next]);

  const urgent = left <= 5 && !revealed;
  return (
    <section aria-labelledby="question" className="grid gap-5">
      <div className="flex items-center justify-between text-sm text-secondary">
        <span>Question {index + 1} sur {questions.length}</span>
        <span className={`tabular-nums ${urgent ? 'font-semibold text-error' : ''}`} role="timer" aria-live="off">{left} s</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised" aria-hidden="true">
        <div className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${urgent ? 'bg-error' : 'bg-accent'}`} style={{ width: `${(left / SECONDS) * 100}%` }} />
      </div>
      <h2 id="question" className="font-display text-2xl font-semibold leading-snug sm:text-3xl">{question.prompt}</h2>
      <ul className="grid gap-3" role="list">
        {question.options.map((option, optionIndex) => {
          const right = revealed && optionIndex === question.answer;
          const wrong = revealed && picked === optionIndex && optionIndex !== question.answer;
          return (
            <li key={option}>
              <button type="button" disabled={revealed} onClick={() => reveal(optionIndex)} className={`flex w-full items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors duration-micro ${right ? 'border-success bg-success/10' : wrong ? 'border-error bg-error/10' : 'border-border bg-surface hover:border-accent'} disabled:cursor-default`}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border text-xs tabular-nums text-secondary">{right ? <Check size={14} aria-hidden="true" /> : wrong ? <X size={14} aria-hidden="true" /> : optionIndex + 1}</span>
                <span>{option}</span>
                {right && <span className="sr-only"> — bonne réponse</span>}
                {wrong && <span className="sr-only"> — mauvaise réponse</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {revealed && (
        <div className="grid gap-3 rounded-card bg-surface-raised p-4" role="status">
          <p className="text-sm">{picked === null ? 'Temps écoulé. ' : picked === question.answer ? 'Bien joué ! ' : 'Raté. '}<span className="text-secondary">{question.fact}</span></p>
          <button type="button" autoFocus onClick={next} className="justify-self-start rounded-control bg-accent px-5 font-semibold text-on-accent hover:bg-accent-hover">{index + 1 >= questions.length ? 'Voir mon score' : 'Question suivante'}</button>
        </div>
      )}
    </section>
  );
}
