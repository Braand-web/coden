import { CATEGORIES, euro, type Expense } from '../data';

export function Summary({ expenses, budget, onBudget }: { expenses: Expense[]; budget: number; onBudget: (value: number) => void }) {
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  const left = budget - total;
  const ratio = budget > 0 ? Math.min(1, total / budget) : 0;
  const over = budget > 0 && total > budget;
  const byCategory = CATEGORIES.map(category => ({ ...category, value: expenses.filter(item => item.category === category.id).reduce((sum, item) => sum + item.amount, 0) })).filter(item => item.value > 0).sort((a, b) => b.value - a.value);

  return (
    <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]" aria-label="Résumé du mois">
      <div className="rounded-card border border-border bg-surface p-5 shadow-card">
        <p className="text-sm text-secondary">Dépensé ce mois-ci</p>
        <p className="mt-1 font-display text-4xl font-semibold tracking-tight" aria-live="polite">{euro(total)}</p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-raised" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label="Part du budget utilisée">
          <div className={`h-full rounded-full transition-[width] duration-state ease-standard ${over ? 'bg-error' : 'bg-accent'}`} style={{ width: `${ratio * 100}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className={over ? 'text-error' : 'text-secondary'}>{budget <= 0 ? 'Aucun budget défini' : over ? `Dépassé de ${euro(-left)}` : `Reste ${euro(left)}`}</span>
          <label className="inline-flex items-center gap-2 text-secondary">Budget
            <input aria-label="Budget mensuel en euros" type="number" min={0} step={10} value={budget || ''} onChange={event => onBudget(Math.max(0, Number(event.target.value) || 0))} className="w-28 rounded-control border border-border bg-surface px-2 text-content" />
          </label>
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface p-5 shadow-card">
        <p className="text-sm text-secondary">Par catégorie</p>
        {byCategory.length === 0 ? <p className="mt-3 text-sm text-tertiary">Rien à répartir pour l’instant.</p> : (
          <ul className="mt-3 grid gap-3">
            {byCategory.map(item => (
              <li key={item.id} className="grid gap-1">
                <div className="flex justify-between text-sm"><span>{item.label}</span><span className="tabular-nums text-secondary">{euro(item.value)}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised"><div className={`h-full rounded-full ${item.tone}`} style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%` }} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
