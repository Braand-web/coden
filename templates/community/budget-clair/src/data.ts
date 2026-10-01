export type Category = 'courses' | 'logement' | 'transport' | 'loisirs' | 'sante' | 'autre';
export type Expense = { id: string; label: string; amount: number; category: Category; date: string };

export const CATEGORIES: Array<{ id: Category; label: string; tone: string }> = [
  { id: 'courses', label: 'Courses', tone: 'bg-accent' },
  { id: 'logement', label: 'Logement', tone: 'bg-info' },
  { id: 'transport', label: 'Transport', tone: 'bg-warning' },
  { id: 'loisirs', label: 'Loisirs', tone: 'bg-success' },
  { id: 'sante', label: 'Santé', tone: 'bg-error' },
  { id: 'autre', label: 'Autre', tone: 'bg-tertiary' },
];

const today = new Date();
const day = (offset: number) => {
  const d = new Date(today.getFullYear(), today.getMonth(), Math.max(1, today.getDate() - offset));
  return d.toISOString().slice(0, 10);
};

// Données d'exemple : elles disparaissent dès que vous ajoutez les vôtres ou videz la liste.
export const SAMPLE: Expense[] = [
  { id: 's1', label: 'Marché du samedi', amount: 38.4, category: 'courses', date: day(1) },
  { id: 's2', label: 'Loyer', amount: 620, category: 'logement', date: day(3) },
  { id: 's3', label: 'Abonnement transport', amount: 45, category: 'transport', date: day(4) },
  { id: 's4', label: 'Cinéma', amount: 24, category: 'loisirs', date: day(6) },
  { id: 's5', label: 'Pharmacie', amount: 17.9, category: 'sante', date: day(7) },
  { id: 's6', label: 'Supermarché', amount: 74.2, category: 'courses', date: day(9) },
];

export const euro = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
export const monthKey = (date: string) => date.slice(0, 7);

export function toCsv(rows: Expense[]): string {
  const cell = (value: string | number) => {
    const text = String(value);
    // Un tableur exécuterait une cellule qui commence par = + - @ : on la neutralise.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return ['Date;Libellé;Catégorie;Montant', ...rows.map(row => [row.date, row.label, row.category, row.amount.toFixed(2).replace('.', ',')].map(cell).join(';'))].join('\n');
}
