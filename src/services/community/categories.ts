/**
 * Categories of the Community. The list lives in the database (`community_categories`) so it can change without a
 * deploy; `DEFAULT_CATEGORIES` is only what a fresh database is seeded with, and the fallback if the table is unreachable.
 *
 * `classifyCategory` is the « agent classifies, the creator corrects » first guess: cheap, deterministic keyword scoring
 * on the title, the description and the app's visible text. It never costs a model call; the creator can always change it.
 */
export type CommunityCategory = { slug: string; label: string };

export const DEFAULT_CATEGORIES: readonly CommunityCategory[] = Object.freeze([
  { slug: 'site-vitrine', label: 'Site vitrine' },
  { slug: 'portfolio', label: 'Portfolio' },
  { slug: 'saas-outils', label: 'SaaS et outils' },
  { slug: 'tableau-de-bord', label: 'Tableau de bord' },
  { slug: 'e-commerce', label: 'E-commerce' },
  { slug: 'jeux', label: 'Jeux' },
  { slug: 'reservation-evenements', label: 'Réservation et événements' },
  { slug: 'blog-contenu', label: 'Blog et contenu' },
  { slug: 'education', label: 'Éducation' },
  { slug: 'autre', label: 'Autre' },
]);

export const FALLBACK_CATEGORY = 'autre';

const KEYWORDS: Record<string, RegExp> = {
  portfolio: /\b(portfolio|portfolios|mes projets|my work|case stud(?:y|ies)|freelance|photographe|photographer|designer|r[ée]alisations|cv\b|resume)\b/i,
  'e-commerce': /\b(boutique|e-?commerce|panier|cart|checkout|shop|store|produits?|products?|commande|paiement|stripe|catalogue|vente)\b/i,
  jeux: /\b(jeu|jeux|game|games|quiz|puzzle|score|niveau|level|player|joueur|morpion|tetris|snake|memory|arcade)\b/i,
  'reservation-evenements': /\b(r[ée]serv\w*|booking|rendez-?vous|appointment|[ée]v[ée]nements?|events?|billets?|tickets?|agenda|calendrier|planning|restaurant|h[ôo]tel|salle)\b/i,
  'blog-contenu': /\b(blog|articles?|actualit[ée]s?|news|magazine|newsletter|posts?|podcast|chroniques?)\b/i,
  education: /\b([ée]ducation|cours|course|formation|apprendre|learn|le[cç]ons?|lessons?|[ée]cole|school|universit[ée]|tutoriel|tutorial|[ée]l[èe]ves?|students?|flashcards?)\b/i,
  'tableau-de-bord': /\b(dashboard|tableau de bord|analytics|statistiques|stats|kpi|m[ée]triques|metrics|rapports?|reporting|crm|suivi)\b/i,
  'saas-outils': /\b(saas|outil|outils|tool|tools|calculat\w*|g[ée]n[ée]rateur|generator|convertisseur|converter|gestion|management|todo|t[âa]ches|tasks|planner|tracker|factur\w*|invoice|workflow|automatis\w*)\b/i,
  'site-vitrine': /\b(site vitrine|landing|vitrine|entreprise|company|agence|agency|services?|[àa] propos|about us|contact|startup|association|cabinet)\b/i,
};

// When two categories tie, the more specific one wins: a shop is more telling than « services ».
const PRIORITY = ['e-commerce', 'jeux', 'reservation-evenements', 'portfolio', 'education', 'tableau-de-bord', 'blog-contenu', 'saas-outils', 'site-vitrine'];

export function classifyCategory(input: { title?: string; description?: string; text?: string }, known: readonly string[] = DEFAULT_CATEGORIES.map(category => category.slug)): { slug: string; confidence: number } {
  const title = String(input.title || '');
  const body = `${input.description || ''} ${String(input.text || '').slice(0, 4000)}`;
  let best = FALLBACK_CATEGORY;
  let bestScore = 0;
  let total = 0;
  for (const slug of PRIORITY) {
    if (!known.includes(slug)) continue;
    const re = KEYWORDS[slug];
    const inTitle = (title.match(new RegExp(re.source, 'gi')) || []).length;
    const inBody = (body.match(new RegExp(re.source, 'gi')) || []).length;
    const score = inTitle * 4 + Math.min(inBody, 8);
    total += score;
    if (score > bestScore) { best = slug; bestScore = score; }
  }
  if (!bestScore) return { slug: FALLBACK_CATEGORY, confidence: 0 };
  return { slug: best, confidence: Math.round((bestScore / Math.max(total, 1)) * 100) / 100 };
}

export function isKnownCategory(slug: string, known: readonly string[] = DEFAULT_CATEGORIES.map(category => category.slug)): boolean {
  return known.includes(slug);
}
