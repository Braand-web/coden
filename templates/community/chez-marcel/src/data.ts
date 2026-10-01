export type Course = 'entrees' | 'plats' | 'desserts';
export type Dish = { name: string; description: string; price: number; course: Course; tag?: string };

export const COURSES: Array<{ id: Course; label: string }> = [
  { id: 'entrees', label: 'Entrées' },
  { id: 'plats', label: 'Plats' },
  { id: 'desserts', label: 'Desserts' },
];

export const MENU: Dish[] = [
  { name: 'Velouté de potimarron', description: 'Châtaignes grillées, huile de noisette.', price: 9, course: 'entrees', tag: 'Végétarien' },
  { name: 'Terrine de campagne', description: 'Pickles maison, pain au levain.', price: 11, course: 'entrees' },
  { name: 'Salade de chèvre chaud', description: 'Miel de la région, noix, jeunes pousses.', price: 12, course: 'entrees', tag: 'Végétarien' },
  { name: 'Joue de bœuf braisée', description: 'Cuisson de six heures, purée au beurre noisette.', price: 24, course: 'plats' },
  { name: 'Filet de bar rôti', description: 'Fenouil confit, beurre blanc citronné.', price: 26, course: 'plats' },
  { name: 'Risotto aux cèpes', description: 'Parmesan vieilli, persil plat.', price: 21, course: 'plats', tag: 'Végétarien' },
  { name: 'Tarte fine aux pommes', description: 'Glace vanille de Madagascar.', price: 9, course: 'desserts' },
  { name: 'Mousse au chocolat noir', description: 'Fleur de sel, éclats de noisette.', price: 8, course: 'desserts', tag: 'Sans gluten' },
  { name: 'Île flottante', description: 'Crème anglaise, caramel au beurre salé.', price: 9, course: 'desserts' },
];

export const HOURS: Array<{ days: string; hours: string }> = [
  { days: 'Mardi – Jeudi', hours: '12h – 14h30 · 19h – 22h' },
  { days: 'Vendredi – Samedi', hours: '12h – 14h30 · 19h – 23h' },
  { days: 'Dimanche', hours: '12h – 15h' },
  { days: 'Lundi', hours: 'Fermé' },
];

export const SLOTS = ['12:00', '12:30', '13:00', '13:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
export const MAX_GUESTS = 10;

export const euro = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);

/** Le restaurant est fermé le lundi : on le dit avant de laisser réserver. */
export function isClosed(date: string): boolean {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 1;
}

export type Booking = { id: string; date: string; slot: string; guests: number; name: string; phone: string; note: string };
