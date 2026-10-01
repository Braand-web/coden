import { useState, type FormEvent } from 'react';
import { CalendarCheck, Minus, Plus, X } from 'lucide-react';
import { MAX_GUESTS, SLOTS, isClosed, type Booking } from '../data';

const todayIso = () => new Date().toISOString().slice(0, 10);

export function Reservation({ bookings, onBook, onCancel }: { bookings: Booking[]; onBook: (booking: Omit<Booking, 'id'>) => void; onCancel: (id: string) => void }) {
  const [date, setDate] = useState(todayIso);
  const [slot, setSlot] = useState('');
  const [guests, setGuests] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const closed = isClosed(date);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (closed) return setError('Le restaurant est fermé le lundi : choisissez un autre jour.');
    if (date < todayIso()) return setError('Cette date est passée.');
    if (!slot) return setError('Choisissez un horaire.');
    if (name.trim().length < 2) return setError('Indiquez le nom de la réservation.');
    if (!/^[+\d][\d .()-]{7,}$/.test(phone.trim())) return setError('Indiquez un numéro de téléphone valide pour vous joindre.');
    setError('');
    onBook({ date, slot, guests, name: name.trim().slice(0, 60), phone: phone.trim().slice(0, 24), note: note.trim().slice(0, 200) });
    setSlot('');
    setNote('');
  };

  const field = 'w-full rounded-control border border-border bg-surface px-3 text-content placeholder:text-tertiary';
  return (
    <section id="reserver" className="grid gap-6 lg:grid-cols-[1.3fr_1fr]" aria-labelledby="book-title">
      <form onSubmit={submit} noValidate className="grid gap-4 rounded-card border border-border bg-surface p-5 shadow-card">
        <h2 id="book-title" className="font-display text-2xl">Réserver une table</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-secondary">Date
            <input className={field} type="date" min={todayIso()} value={date} onChange={event => { setDate(event.target.value); setSlot(''); }} />
          </label>
          <div className="grid gap-1 text-sm text-secondary">Couverts
            <div className="flex items-center justify-between rounded-control border border-border bg-surface px-1">
              <button type="button" onClick={() => setGuests(count => Math.max(1, count - 1))} className="grid size-10 place-items-center rounded-control hover:bg-surface-raised" aria-label="Un couvert de moins"><Minus size={16} aria-hidden="true" /></button>
              <span className="min-w-16 text-center text-content" aria-live="polite">{guests} {guests > 1 ? 'personnes' : 'personne'}</span>
              <button type="button" onClick={() => setGuests(count => Math.min(MAX_GUESTS, count + 1))} className="grid size-10 place-items-center rounded-control hover:bg-surface-raised" aria-label="Un couvert de plus"><Plus size={16} aria-hidden="true" /></button>
            </div>
          </div>
        </div>
        {closed && <p role="status" className="rounded-control bg-surface-raised px-3 py-2 text-sm text-warning">Fermé le lundi — choisissez un autre jour.</p>}
        <fieldset disabled={closed} className="grid gap-2 border-0 p-0">
          <legend className="mb-1 text-sm text-secondary">Horaire</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Horaire">
            {SLOTS.map(item => (
              <button key={item} type="button" role="radio" aria-checked={slot === item} onClick={() => setSlot(item)} className={`rounded-control border px-4 text-sm tabular-nums transition-colors duration-micro ${slot === item ? 'border-accent bg-accent text-on-accent' : 'border-border bg-surface hover:border-accent'}`}>{item.replace(':', 'h')}</button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-secondary">Nom
            <input className={field} value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={60} />
          </label>
          <label className="grid gap-1 text-sm text-secondary">Téléphone
            <input className={field} value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" maxLength={24} />
          </label>
        </div>
        <label className="grid gap-1 text-sm text-secondary">Une précision ? (allergie, anniversaire…)
          <textarea className={`${field} py-2`} rows={2} value={note} onChange={event => setNote(event.target.value)} maxLength={200} />
        </label>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-control bg-accent px-5 font-semibold text-on-accent transition-colors duration-micro hover:bg-accent-hover">
          <CalendarCheck size={17} aria-hidden="true" /> Confirmer la réservation
        </button>
        <p className="text-xs text-tertiary">Cette démo enregistre vos réservations dans ce navigateur uniquement : aucun message n’est envoyé.</p>
      </form>

      <aside className="grid content-start gap-3 rounded-card border border-border bg-surface p-5 shadow-card" aria-labelledby="mine-title">
        <h3 id="mine-title" className="font-display text-xl">Vos réservations</h3>
        {bookings.length === 0 ? <p className="text-sm text-secondary">Aucune réservation pour l’instant.</p> : (
          <ul className="grid gap-2">
            {[...bookings].sort((a, b) => `${a.date}${a.slot}`.localeCompare(`${b.date}${b.slot}`)).map(item => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-control bg-surface-raised px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{new Date(`${item.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}, {item.slot.replace(':', 'h')}</p>
                  <p className="text-secondary">{item.guests} {item.guests > 1 ? 'personnes' : 'personne'} · {item.name}</p>
                </div>
                <button type="button" onClick={() => onCancel(item.id)} className="grid size-8 place-items-center rounded-control text-tertiary hover:text-error" aria-label={`Annuler la réservation de ${item.name}`}><X size={16} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </section>
  );
}
