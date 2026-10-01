import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { CATEGORIES, type Category, type Expense } from '../data';

export function ExpenseForm({ onAdd }: { onAdd: (expense: Omit<Expense, 'id'>) => void }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category>('courses');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount.replace(',', '.'));
    if (!label.trim()) return setError('Donnez un libellé à cette dépense.');
    if (!Number.isFinite(value) || value <= 0) return setError('Le montant doit être un nombre supérieur à zéro.');
    setError('');
    onAdd({ label: label.trim().slice(0, 60), amount: Math.round(value * 100) / 100, category, date });
    setLabel('');
    setAmount('');
  };

  const field = 'w-full rounded-control border border-border bg-surface px-3 text-content placeholder:text-tertiary';
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" aria-label="Ajouter une dépense" noValidate>
      <label className="grid gap-1 text-sm text-secondary sm:col-span-2 lg:col-span-1">Libellé
        <input className={field} value={label} onChange={event => setLabel(event.target.value)} placeholder="Ex. Marché" maxLength={60} />
      </label>
      <label className="grid gap-1 text-sm text-secondary">Montant (€)
        <input className={field} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" />
      </label>
      <label className="grid gap-1 text-sm text-secondary">Catégorie
        <select className={field} value={category} onChange={event => setCategory(event.target.value as Category)}>
          {CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-secondary">Date
        <input className={field} type="date" value={date} onChange={event => setDate(event.target.value)} />
      </label>
      <button type="submit" className="mt-auto inline-flex items-center justify-center gap-2 rounded-control bg-accent px-4 font-semibold text-on-accent transition-colors duration-micro hover:bg-accent-hover">
        <Plus size={16} aria-hidden="true" /> Ajouter
      </button>
      {error && <p role="alert" className="text-sm text-error sm:col-span-2 lg:col-span-5">{error}</p>}
    </form>
  );
}
