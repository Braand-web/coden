const COMMAND_WORDS = new Set([
  'a', 'an', 'app', 'application', 'build', 'create', 'cree', 'creer', 'crée', 'créer',
  'de', 'des', 'du', 'for', 'generate', 'genere', 'generer', 'génère', 'générer', 'la',
  'le', 'les', 'make', 'me', 'mini', 'mon', 'my', 'pour', 'site', 'the', 'un', 'une',
  'web', 'website', 'with', 'avec', 'moderne', 'modern', 'interactive', 'complete',
  'complet', 'fonctionnelle', 'fonctionnel', 'functional',
]);

const PRODUCT_NAMES: Array<[RegExp, string]> = [
  [/\b(veterinary|veterinarian|vet|veterinaire|veterinaire|clinique veterinaire)\b/i, 'Veterinary Appointment Portal'],
  [/\b(calculator|calculatrice|calcul)\b/i, 'QuickCalc'],
  [/\b(pomodoro|pomodero|focus timer|minuteur|timer)\b/i, 'FocusLoop'],
  [/\b(todo|to-do|to do|task|tache|tâche|checklist)\b/i, 'TaskFlow'],
  [/\b(habit|habitude|routine)\b/i, 'HabitPulse'],
  [/\b(weather|meteo|météo|forecast)\b/i, 'SkyCast'],
  [/\b(notes?|memo|mémo|notepad)\b/i, 'NoteSpace'],
  [/\b(quiz|qcm|trivia)\b/i, 'QuizSpark'],
  [/\b(chat|messagerie|messenger)\b/i, 'TalkSpace'],
  [/\b(booking|reservation|réservation|appointment|rendez-vous)\b/i, 'BookFlow'],
  [/\b(ecommerce|e-commerce|shop|store|boutique|catalogue|cart|panier)\b/i, 'StoreFront'],
  [/\b(crm|customer relationship|pipeline)\b/i, 'ClientFlow'],
  [/\b(dashboard|analytics|kpi|admin)\b/i, 'InsightDesk'],
  [/\b(portfolio|agency|agence)\b/i, 'Showcase'],
  [/\b(restaurant|menu|cafe|café)\b/i, 'TableStory'],
  [/\b(finance|budget|expense|depense|dépense)\b/i, 'MoneyMap'],
  [/\b(game|jeu|gaming)\b/i, 'PlayLab'],
];

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function deriveProjectName(prompt = '', fallback = 'New Coden app') {
  const source = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!source) return fallback;

  const knownProduct = PRODUCT_NAMES.find(([pattern]) => pattern.test(source));
  if (knownProduct) return knownProduct[1];

  const meaningful = source
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !COMMAND_WORDS.has(word.toLowerCase()))
    .slice(0, 4);

  return meaningful.length ? titleCase(meaningful.join(' ')).slice(0, 60) : fallback;
}

export function isAutomaticallyDerivedProjectName(name = '', prompt = '') {
  const clean = String(name || '').trim();
  if (!clean || /^(untitled app|new coden app|coden app)$/i.test(clean)) return true;
  return clean.toLowerCase() === deriveProjectName(prompt).toLowerCase()
    || clean.toLowerCase() === String(prompt || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 90);
}

/**
 * A project's slug is its public address: `<slug>.<root domain>` is the link the
 * user shares once the app is published. Reassigning it would strand that link
 * on the previously deployed build and orphan the old deployment, so a project
 * that is already live keeps its slug no matter how its display name evolves.
 */
export function canReassignProjectSlug(input: {
  currentName: string;
  nextName: string;
  hasLiveDeployment: boolean;
}): boolean {
  if (input.nextName === input.currentName) return false;
  return !input.hasLiveDeployment;
}

export function sanitizeSuggestedProjectName(value: unknown, prompt = '') {
  const clean = String(value || '')
    .replace(/[^\p{L}\p{N}\s&'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  if (!clean || clean.split(/\s+/).length > 6) return deriveProjectName(prompt);
  return clean;
}
