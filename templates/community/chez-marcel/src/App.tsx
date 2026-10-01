import { useEffect, useState } from 'react';
import { Clock, MapPin, Moon, Sun, Utensils } from 'lucide-react';
import { Reservation } from './components/Reservation';
import { COURSES, HOURS, MENU, euro, type Booking, type Course } from './data';
import './theme.css';

const STORE = 'chez-marcel:v1';

function load(): { bookings: Booking[]; theme: 'light' | 'dark' } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (raw && Array.isArray(raw.bookings)) return { bookings: raw.bookings, theme: raw.theme === 'dark' ? 'dark' : 'light' };
  } catch { /* stockage indisponible : on repart d’une liste vide */ }
  return { bookings: [], theme: 'light' };
}

export default function App() {
  const [state, setState] = useState(load);
  const [course, setCourse] = useState<Course>('plats');
  const [confirmed, setConfirmed] = useState<Booking | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* sans stockage, la démo marche quand même */ }
  }, [state]);

  const book = (booking: Omit<Booking, 'id'>) => {
    const created = { ...booking, id: crypto.randomUUID() };
    setState(current => ({ ...current, bookings: [...current.bookings, created] }));
    setConfirmed(created);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="#top" className="inline-flex items-center gap-2 whitespace-nowrap font-display text-xl"><Utensils size={18} className="text-accent" aria-hidden="true" /> Chez Marcel</a>
          <nav aria-label="Principal" className="flex items-center gap-1 text-sm">
            <a className="rounded-control px-3 py-2 text-secondary hover:text-content" href="#carte">La carte</a>
            <a className="hidden rounded-control px-3 py-2 text-secondary hover:text-content sm:inline-block" href="#infos">Infos</a>
            <a className="rounded-control bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-hover" href="#reserver">Réserver</a>
            <button type="button" onClick={() => setState(current => ({ ...current, theme: current.theme === 'dark' ? 'light' : 'dark' }))} className="ml-1 grid size-10 place-items-center rounded-control text-secondary hover:text-content" aria-label={state.theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}>
              {state.theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
            </button>
          </nav>
        </div>
      </header>

      <main id="top" className="mx-auto grid max-w-5xl gap-16 px-4 pb-20 pt-12 sm:px-6">
        <section className="grid gap-5 py-6 sm:py-12" aria-labelledby="hero-title">
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">Cuisine de marché</p>
          <h1 id="hero-title" className="max-w-2xl font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">Des produits de saison, cuisinés sans détour.</h1>
          <p className="max-w-xl text-lg text-secondary">Une carte courte qui change avec le marché, des vins de petits producteurs et une salle à taille humaine, au cœur de la ville.</p>
          <div className="flex flex-wrap gap-3">
            <a href="#reserver" className="rounded-control bg-accent px-6 py-3 font-semibold text-on-accent hover:bg-accent-hover">Réserver une table</a>
            <a href="#carte" className="rounded-control border border-border bg-surface px-6 py-3 font-semibold hover:border-accent">Voir la carte</a>
          </div>
        </section>

        <section id="carte" aria-labelledby="carte-title" className="grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="carte-title" className="font-display text-3xl">La carte</h2>
            <div className="inline-flex gap-1 rounded-full border border-border bg-surface p-1" role="tablist" aria-label="Parties de la carte">
              {COURSES.map(item => (
                <button key={item.id} type="button" role="tab" aria-selected={course === item.id} onClick={() => setCourse(item.id)} className={`rounded-full px-4 text-sm font-medium transition-colors duration-micro ${course === item.id ? 'bg-accent text-on-accent' : 'text-secondary hover:text-content'}`} style={{ minHeight: 36 }}>{item.label}</button>
              ))}
            </div>
          </div>
          <ul className="grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-1" role="tabpanel">
            {MENU.filter(dish => dish.course === course).map(dish => (
              <li key={dish.name} className="flex items-start justify-between gap-4 bg-surface px-5 py-4">
                <div>
                  <p className="font-display text-lg">{dish.name}{dish.tag && <span className="ml-2 rounded-full bg-surface-raised px-2 py-0.5 align-middle font-sans text-xs text-secondary">{dish.tag}</span>}</p>
                  <p className="text-sm text-secondary">{dish.description}</p>
                </div>
                <p className="font-display text-lg tabular-nums">{euro(dish.price)}</p>
              </li>
            ))}
          </ul>
        </section>

        <Reservation bookings={state.bookings} onBook={book} onCancel={id => setState(current => ({ ...current, bookings: current.bookings.filter(item => item.id !== id) }))} />

        <section id="infos" aria-labelledby="infos-title" className="grid gap-6 sm:grid-cols-2">
          <div className="grid content-start gap-3 rounded-card border border-border bg-surface p-5">
            <h2 id="infos-title" className="inline-flex items-center gap-2 font-display text-2xl"><Clock size={18} className="text-accent" aria-hidden="true" /> Horaires</h2>
            <dl className="grid gap-2 text-sm">
              {HOURS.map(item => <div key={item.days} className="flex justify-between gap-4"><dt className="text-secondary">{item.days}</dt><dd className="text-right">{item.hours}</dd></div>)}
            </dl>
          </div>
          <div className="grid content-start gap-3 rounded-card border border-border bg-surface p-5">
            <h2 className="inline-flex items-center gap-2 font-display text-2xl"><MapPin size={18} className="text-accent" aria-hidden="true" /> Nous trouver</h2>
            <p className="text-sm text-secondary">12 rue des Halles, au cœur de la ville. Entrée de plain-pied, tables accessibles. Chiens bienvenus en terrasse.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-subtle py-6 text-center text-xs text-tertiary">Chez Marcel — site de démonstration. Adresse et menu fictifs.</footer>

      {confirmed && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="ok-title" onClick={() => setConfirmed(null)}>
          <div className="grid max-w-sm gap-3 rounded-modal border border-border bg-surface p-6 shadow-card-hover" onClick={event => event.stopPropagation()}>
            <h2 id="ok-title" className="font-display text-2xl">Table réservée</h2>
            <p className="text-secondary">{confirmed.name}, nous vous attendons le {new Date(`${confirmed.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à {confirmed.slot.replace(':', 'h')} pour {confirmed.guests} {confirmed.guests > 1 ? 'personnes' : 'personne'}.</p>
            <button type="button" autoFocus onClick={() => setConfirmed(null)} className="rounded-control bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover">Parfait</button>
          </div>
        </div>
      )}
    </div>
  );
}
