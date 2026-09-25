/**
 * The welcome onboarding: its questions, when it is shown, and which plan it
 * recommends from the answers. Pure, so every rule here is tested.
 *
 * Answers live in the account's Supabase user_metadata (`coden_onboarding`),
 * so they follow the person across devices without a schema change; a local
 * flag keeps it from reappearing if that write fails.
 */

export type OnboardingAnswers = {
  profile?: string;
  goal?: string;
  project?: string;
  usage?: string;
};

export type OnboardingRecord = OnboardingAnswers & {
  completed_at?: string;
  skipped?: boolean;
  version?: number;
};

export type OnboardingOption = { value: string; label: string; hint: string; icon: string };
export type OnboardingStep = { key: keyof OnboardingAnswers; title: string; subtitle: string; options: OnboardingOption[] };

export const ONBOARDING_VERSION = 1;

/** Shown to accounts younger than this that have not finished or skipped it. */
export const ONBOARDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: 'profile',
    title: 'Qui êtes-vous ?',
    subtitle: 'Pour adapter Coden à votre façon de travailler.',
    options: [
      { value: 'founder', label: 'Fondateur ou fondatrice', hint: 'Je lance mon produit', icon: 'rocket' },
      { value: 'freelancer', label: 'Indépendant', hint: 'Je crée pour mes clients', icon: 'briefcase' },
      { value: 'agency', label: 'Agence', hint: 'Une équipe, plusieurs clients', icon: 'users' },
      { value: 'developer', label: 'Développeur', hint: 'Je veux aller plus vite', icon: 'code' },
      { value: 'marketer', label: 'Marketing ou produit', hint: 'Je teste des idées', icon: 'megaphone' },
      { value: 'other', label: 'Autre', hint: 'Curieux de découvrir', icon: 'dots' },
    ],
  },
  {
    key: 'goal',
    title: 'Quel est votre objectif ?',
    subtitle: 'Ce que vous voulez obtenir en premier.',
    options: [
      { value: 'launch', label: 'Lancer un produit', hint: 'Un SaaS ou une app à vendre', icon: 'rocket' },
      { value: 'internal', label: 'Un outil interne', hint: 'Gagner du temps au quotidien', icon: 'wrench' },
      { value: 'client', label: 'Un site pour un client', hint: 'Livrer vite et bien', icon: 'briefcase' },
      { value: 'prototype', label: 'Prototyper une idée', hint: 'Valider avant d’investir', icon: 'bulb' },
      { value: 'learn', label: 'Apprendre', hint: 'Voir ce que l’IA sait faire', icon: 'book' },
    ],
  },
  {
    key: 'project',
    title: 'Quel type de projet ?',
    subtitle: 'Coden prépare le bon point de départ.',
    options: [
      { value: 'saas', label: 'SaaS', hint: 'Comptes, abonnements, tableau de bord', icon: 'layers' },
      { value: 'shop', label: 'Boutique en ligne', hint: 'Catalogue, panier, paiement', icon: 'cart' },
      { value: 'website', label: 'Site vitrine', hint: 'Présenter une activité', icon: 'globe' },
      { value: 'dashboard', label: 'Tableau de bord', hint: 'Données et indicateurs', icon: 'chart' },
      { value: 'app', label: 'Application web', hint: 'Réservation, CRM, outil métier', icon: 'phone' },
      { value: 'other', label: 'Autre chose', hint: 'Je verrai en chemin', icon: 'dots' },
    ],
  },
  {
    key: 'usage',
    title: 'Comment allez-vous l’utiliser ?',
    subtitle: 'Pour vous proposer la formule adaptée.',
    options: [
      { value: 'personal', label: 'Pour moi', hint: 'Un ou deux projets', icon: 'user' },
      { value: 'clients', label: 'Pour mes clients', hint: 'Plusieurs projets en parallèle', icon: 'briefcase' },
      { value: 'team', label: 'En équipe', hint: 'Plusieurs personnes, rôles et accès', icon: 'users' },
      { value: 'exploring', label: 'Je découvre', hint: 'Juste pour essayer', icon: 'compass' },
    ],
  },
];

/**
 * Whether to open the onboarding now.
 *
 * Only for a recent account that has neither finished nor skipped it, and
 * never over work in flight: someone who arrived with a prompt goes to the
 * Builder first and sees this on a later visit.
 */
export function shouldShowOnboarding(input: {
  createdAt?: string | null;
  record?: OnboardingRecord | null;
  locallyDone?: boolean;
  pendingPrompt?: boolean;
  now?: number;
}): boolean {
  if (input.locallyDone || input.pendingPrompt) return false;
  if (input.record && (input.record.completed_at || input.record.skipped)) return false;
  const created = Date.parse(String(input.createdAt || ''));
  if (!Number.isFinite(created)) return false;
  const age = (input.now ?? Date.now()) - created;
  return age >= 0 && age <= ONBOARDING_WINDOW_MS;
}

/** A team, an agency or client work is a Business account; everyone else starts on Pro. */
export function recommendPlan(answers: OnboardingAnswers): 'pro' | 'business' {
  if (answers.usage === 'team' || answers.profile === 'agency') return 'business';
  if (answers.usage === 'clients' && answers.goal === 'client') return 'business';
  return 'pro';
}

/** Only known values, so user_metadata never carries anything a person did not choose. */
export function sanitizeAnswers(answers: OnboardingAnswers): OnboardingAnswers {
  const clean: OnboardingAnswers = {};
  for (const step of ONBOARDING_STEPS) {
    const value = answers[step.key];
    if (value && step.options.some(option => option.value === value)) clean[step.key] = value;
  }
  return clean;
}
