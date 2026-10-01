import { useEffect, useState } from 'react';
import { Globe2, Moon, RotateCcw, Sun, Trophy } from 'lucide-react';
import { Quiz, type Result } from './components/Quiz';
import { QUESTIONS, type Question } from './questions';
import './theme.css';

const STORE = 'cap-sur-le-monde:v1';
const ROUND = 10;

function load(): { best: number; played: number; theme: 'light' | 'dark' } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (raw) return { best: Number(raw.best) || 0, played: Number(raw.played) || 0, theme: raw.theme === 'dark' ? 'dark' : 'light' };
  } catch { /* stockage indisponible */ }
  return { best: 0, played: 0, theme: 'light' };
}

/** Dix questions tirées au hasard, sans doublon : Fisher-Yates, pas un tri aléatoire biaisé. */
function draw(): Question[] {
  const pool = [...QUESTIONS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, ROUND);
}

function longestStreak(results: Result[]): number {
  let best = 0;
  let run = 0;
  for (const item of results) {
    run = item.picked === item.question.answer ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export default function App() {
  const [stats, setStats] = useState(load);
  const [round, setRound] = useState<Question[] | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = stats.theme;
    try { localStorage.setItem(STORE, JSON.stringify(stats)); } catch { /* sans stockage, le jeu marche quand même */ }
  }, [stats]);

  const score = results ? results.filter(item => item.picked === item.question.answer).length : 0;
  const finish = (done: Result[]) => {
    const points = done.filter(item => item.picked === item.question.answer).length;
    setResults(done);
    setRound(null);
    setStats(current => ({ ...current, best: Math.max(current.best, points), played: current.played + 1 }));
  };

  return (
    <div className="mx-auto grid min-h-screen max-w-2xl content-start gap-8 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-control bg-accent text-on-accent" aria-hidden="true"><Globe2 size={20} /></span>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Cap sur le monde</h1>
        </div>
        <button type="button" onClick={() => setStats(current => ({ ...current, theme: current.theme === 'dark' ? 'light' : 'dark' }))} className="grid size-10 place-items-center rounded-control border border-border bg-surface text-secondary hover:text-content" aria-label={stats.theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}>
          {stats.theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </button>
      </header>

      <main>
        {round ? <Quiz questions={round} onFinish={finish} /> : results ? (
          <section className="grid gap-5 text-center" aria-labelledby="done-title">
            <p className="text-sm text-secondary">Votre score</p>
            <h2 id="done-title" className="font-display text-7xl font-semibold tabular-nums">{score}<span className="text-3xl text-tertiary"> / {results.length}</span></h2>
            <p className="text-secondary">{score >= 9 ? 'Cartographe confirmé !' : score >= 6 ? 'Belle exploration.' : 'Le tour du monde continue : la prochaine sera la bonne.'} Meilleure série : {longestStreak(results)}.</p>
            {score > 0 && score === stats.best && <p className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-accent"><Trophy size={15} aria-hidden="true" /> Meilleur score personnel</p>}
            <ol className="grid gap-2 text-left text-sm">
              {results.map((item, position) => {
                const right = item.picked === item.question.answer;
                return (
                  <li key={item.question.prompt} className="flex gap-3 rounded-control bg-surface-raised px-3 py-2">
                    <span className={right ? 'text-success' : 'text-error'} aria-label={right ? 'Juste' : 'Faux'}>{right ? '✓' : '✗'}</span>
                    <span><span className="text-secondary">{position + 1}. {item.question.prompt}</span><br />Réponse : {item.question.options[item.question.answer]}</span>
                  </li>
                );
              })}
            </ol>
            <button type="button" onClick={() => { setResults(null); setRound(draw()); }} className="inline-flex items-center justify-center gap-2 justify-self-center rounded-control bg-accent px-6 font-semibold text-on-accent hover:bg-accent-hover"><RotateCcw size={16} aria-hidden="true" /> Rejouer</button>
          </section>
        ) : (
          <section className="grid gap-6" aria-labelledby="start-title">
            <h2 id="start-title" className="font-display text-4xl font-semibold leading-tight sm:text-5xl">Dix questions, quinze secondes chacune.</h2>
            <p className="text-lg text-secondary">Capitales, fleuves, montagnes : testez votre sens de l’orientation. Répondez au clic ou avec les touches 1 à 4.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-card border border-border bg-surface p-4"><p className="text-sm text-secondary">Meilleur score</p><p className="font-display text-3xl tabular-nums">{stats.best} <span className="text-base text-tertiary">/ {ROUND}</span></p></div>
              <div className="rounded-card border border-border bg-surface p-4"><p className="text-sm text-secondary">Parties jouées</p><p className="font-display text-3xl tabular-nums">{stats.played}</p></div>
            </div>
            <button type="button" onClick={() => setRound(draw())} className="justify-self-start rounded-control bg-accent px-8 py-3 text-lg font-semibold text-on-accent hover:bg-accent-hover">Commencer</button>
          </section>
        )}
      </main>
      <footer className="text-center text-xs text-tertiary">Vos scores restent dans ce navigateur.</footer>
    </div>
  );
}
