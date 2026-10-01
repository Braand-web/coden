/**
 * Coden's official templates.
 *
 * A template is a brief the agent builds from: what the app is, which pages and states it has, which content is
 * placeholder. Using one creates a normal project in the person's account and sends the brief to the agent as the first
 * request, so the result gets the same design identity, checks and credits as any other build. Nothing in a brief is
 * personal data or a secret. They are listed in the database too (`community_templates`) so an admin can switch one off
 * or restrict it to a plan without a deploy; this list seeds that table.
 */
export type OfficialTemplate = {
  slug: string;
  title: string;
  description: string;
  category: string;
  brief: string;
  /** `app`: a complete, tested app (files in `templates/community/<slug>/`); `brief`: a request the agent builds from. */
  kind?: 'app' | 'brief';
  /** Measured by the template test run (see docs/community-verification.md); absent until it has been run. */
  designScore?: number;
};

const COMMON = ' Fais un design soigné et cohérent, responsive du mobile au bureau, avec thème clair et sombre, états de chargement, vide et erreur, navigation au clavier et focus visible. Utilise du contenu d’exemple réaliste en français, sans donnée personnelle réelle.';

export const OFFICIAL_TEMPLATES: readonly OfficialTemplate[] = Object.freeze([
  // Three complete apps, tested in a real browser (scripts/community/test-template-apps.mjs): a person who picks one gets a
  // working project in their account, ready to publish, and the agent can change it like any other.
  {
    slug: 'budget-clair', kind: 'app', title: 'Budget Clair', category: 'tableau-de-bord',
    description: 'Suivi de dépenses du mois : budget, répartition par catégorie, filtres et export CSV.',
    brief: 'Suivi de dépenses du mois : budget, répartition par catégorie, filtres et export CSV.',
  },
  {
    slug: 'chez-marcel', kind: 'app', title: 'Chez Marcel', category: 'reservation-evenements',
    description: 'Site de restaurant : carte par onglets, horaires et réservation de table avec créneaux.',
    brief: 'Site de restaurant : carte par onglets, horaires et réservation de table avec créneaux.',
  },
  {
    slug: 'cap-sur-le-monde', kind: 'app', title: 'Cap sur le monde', category: 'jeux',
    description: 'Quiz de géographie : dix questions, chrono, meilleur score et correction détaillée.',
    brief: 'Quiz de géographie : dix questions, chrono, meilleur score et correction détaillée.',
  },
  {
    slug: 'site-vitrine-entreprise', title: 'Site vitrine d’entreprise', category: 'site-vitrine',
    description: 'Page d’accueil, services, réalisations, équipe et contact pour présenter une activité.',
    brief: `Construis un site vitrine d’entreprise : en-tête avec navigation, section d’accueil avec un message clair et un appel à l’action, services, réalisations ou références, équipe, témoignages, questions fréquentes et formulaire de contact avec validation.${COMMON}`,
  },
  {
    slug: 'portfolio-createur', title: 'Portfolio de créateur', category: 'portfolio',
    description: 'Présentation, galerie de projets filtrable, page de projet et contact.',
    brief: `Construis un portfolio de créateur indépendant : présentation, galerie de projets filtrable par catégorie, page détaillée pour chaque projet, parcours, compétences et contact.${COMMON}`,
  },
  {
    slug: 'tableau-de-bord-ventes', title: 'Tableau de bord des ventes', category: 'tableau-de-bord',
    description: 'Indicateurs, graphiques, filtres par période et tableau détaillé exportable.',
    brief: `Construis un tableau de bord des ventes : indicateurs clés, graphiques d’évolution et de répartition, filtres par période et par région, tableau détaillé triable avec export CSV. Les données sont des exemples stockés dans l’app.${COMMON}`,
  },
  {
    slug: 'boutique-en-ligne', title: 'Boutique en ligne', category: 'e-commerce',
    description: 'Catalogue, fiche produit, panier et récapitulatif de commande.',
    brief: `Construis une boutique en ligne : catalogue avec recherche et filtres, fiche produit avec galerie et variantes, panier persistant, récapitulatif de commande. Le paiement est simulé : aucune vraie transaction.${COMMON}`,
  },
  {
    slug: 'reservation-rendez-vous', title: 'Réservation de rendez-vous', category: 'reservation-evenements',
    description: 'Choix du service, du créneau, formulaire et confirmation.',
    brief: `Construis une application de réservation de rendez-vous : choix du service, calendrier avec créneaux disponibles, formulaire de coordonnées, écran de confirmation, et une vue pour annuler ou déplacer un rendez-vous.${COMMON}`,
  },
  {
    slug: 'blog-editorial', title: 'Blog éditorial', category: 'blog-contenu',
    description: 'Articles, catégories, page d’article lisible et abonnement à la lettre.',
    brief: `Construis un blog éditorial : liste d’articles avec catégories et recherche, page d’article très lisible avec table des matières, articles liés, et inscription à une lettre d’information avec validation.${COMMON}`,
  },
  {
    slug: 'cours-en-ligne', title: 'Plateforme de cours', category: 'education',
    description: 'Catalogue de cours, leçons, progression et quiz.',
    brief: `Construis une plateforme de cours en ligne : catalogue de cours, page de cours avec programme, lecteur de leçons, suivi de progression, quiz de fin de module avec correction.${COMMON}`,
  },
  {
    slug: 'outil-de-gestion-taches', title: 'Gestionnaire de tâches', category: 'saas-outils',
    description: 'Listes, tableau kanban, échéances et filtres.',
    brief: `Construis un gestionnaire de tâches : vue liste et vue tableau kanban avec glisser-déposer accessible au clavier, échéances, priorités, filtres et recherche, données conservées dans le navigateur.${COMMON}`,
  },
]);
