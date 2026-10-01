import { useEffect, useMemo, useState } from 'react';
import { Download, Moon, Sun, Trash2, Wallet } from 'lucide-react';
import { ExpenseForm } from './components/ExpenseForm';
import { Summary } from './components/Summary';
import { CATEGORIES, SAMPLE, euro, monthKey, toCsv, type Category, type Expense } from './data';
import './theme.css';

const STORE = 'budget-clair:v1';

function load(): { expenses: Expense[]; budget: number; theme: 'light' | 'dark' } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (raw && Array.isArray(raw.expenses)) return { expenses: raw.expenses, budget: Number(raw.budget) || 0, theme: raw.theme === 'dark' ? 'dark' : 'light' };
  } catch { /* stockage indisponible ou corrompu : on repart des exemples */ }
  return { expenses: SAMPLE, budget: 900, theme: 'light' };
}

export default function App() {
  const [state, setState] = useState(load);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const { expenses, budget, theme } = state;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* sans stockage, l’app marche quand même */ }
  }, [state, theme]);

  const thisMonth = monthKey(new Date().toISOString());
  const monthExpenses = useMemo(() => expenses.filter(item => monthKey(item.date) === thisMonth), [expenses, thisMonth]);
  const visible = useMemo(() => [...monthExpenses].filter(item => filter === 'all' || item.category === filter).sort((a, b) => b.date.localeCompare(a.date)), [monthExpenses, filter]);

  const add = (expense: Omit<Expense, 'id'>) => setState(current => ({ ...current, expenses: [{ ...expense, id: crypto.randomUUID() }, ...current.expenses] }));
  const remove = (id: string) => setState(current => ({ ...current, expenses: current.expenses.filter(item => item.id !== id) }));
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([`﻿${toCsv(visible)}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `depenses-${thisMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl content-start gap-6 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-control bg-accent text-on-accent" aria-hidden="true"><Wallet size={20} /></span>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Budget Clair</h1>
            <p className="text-sm text-secondary">{new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        <button type="button" onClick={() => setState(current => ({ ...current, theme: current.theme === 'dark' ? 'light' : 'dark' }))} className="inline-flex items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm text-secondary hover:text-content" aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}>
          {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          <span className="hidden sm:inline">{theme === 'dark' ? 'Clair' : 'Sombre'}</span>
        </button>
      </header>

      <main className="grid gap-6">
        <Summary expenses={monthExpenses} budget={budget} onBudget={value => setState(current => ({ ...current, budget: value }))} />
        <ExpenseForm onAdd={add} />

        <section aria-labelledby="list-title" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="list-title" className="text-lg font-semibold">Dépenses du mois</h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="filter">Filtrer par catégorie</label>
              <select id="filter" value={filter} onChange={event => setFilter(event.target.value as Category | 'all')} className="rounded-control border border-border bg-surface px-3 text-sm text-content">
                <option value="all">Toutes les catégories</option>
                {CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <button type="button" onClick={exportCsv} disabled={visible.length === 0} className="inline-flex items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm text-secondary hover:text-content disabled:opacity-50">
                <Download size={15} aria-hidden="true" /> Export CSV
              </button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-card border border-dashed border-border p-8 text-center text-sm text-secondary" role="status">
              {monthExpenses.length === 0 ? 'Aucune dépense ce mois-ci. Ajoutez la première ci-dessus.' : 'Aucune dépense dans cette catégorie.'}
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border bg-surface shadow-card">
              {visible.map(item => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.label}</p>
                    <p className="text-xs text-tertiary">{new Date(`${item.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · {CATEGORIES.find(category => category.id === item.category)?.label}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums font-semibold">{euro(item.amount)}</span>
                    <button type="button" onClick={() => remove(item.id)} className="grid size-9 place-items-center rounded-control text-tertiary hover:bg-surface-raised hover:text-error" aria-label={`Supprimer ${item.label}`}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <footer className="pb-4 text-center text-xs text-tertiary">Vos données restent dans ce navigateur : rien n’est envoyé nulle part.</footer>
    </div>
  );
}
