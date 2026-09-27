import {
  ACTION_CREDIT_PRICES,
  BILLING_PLANS,
  priceFor,
  publicationLabel,
} from '../config/billing-v2.ts';

/** Public, user-facing navigation only. Never add internal URLs, tools or account data here. */
export const CODEN_PRODUCT_HELP_VERSION = '2026-09-27';

type HelpTopic = {
  id: string;
  route: string;
  terms: readonly string[];
  guidance: string;
};

export const PUBLIC_HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: 'account', route: '/auth.html',
    terms: ['connexion', 'connecter', 'inscription', 'inscrire', 'compte', 'google', 'mot de passe', 'password'],
    guidance: 'Sur Connexion, choisissez « Continuer avec Google » ou utilisez votre e-mail. L’onglet « Créer un compte » sert à l’inscription. « Mot de passe oublié ? » lance la récupération. Ne demandez jamais au client son mot de passe ou un code de connexion.',
  },
  {
    id: 'projects', route: '/dashboard.html',
    terms: ['mes projets', 'nouveau projet', 'retrouver mon projet', 'rechercher un projet', 'dashboard', 'tableau de bord'],
    guidance: 'Dans le Dashboard, « Nouveau projet » ouvre le Builder. « Mes projets » montre les projets; la recherche et « Récemment vus » aident à retrouver un projet. Ouvrez sa carte pour revenir dans le Builder. Ne prétendez pas voir un projet si son état n’est pas fourni dans les faits vérifiés.',
  },
  {
    id: 'builder', route: '/builder.html',
    terms: ['builder', 'apercu', 'preview', 'modifier mon site', 'generer une application', 'generer un site', 'iteration', 'iterer'],
    guidance: 'Dans le Builder, décrivez la création ou modification dans le chat. « Aperçu » affiche le résultat; les commandes ordinateur, tablette et mobile permettent de vérifier les formats. Le panneau Cloud concerne les services du projet. Une demande terminée et un aperçu vérifié sont deux états distincts : ne promettez pas un résultat sans vérification.',
  },
  {
    id: 'publish', route: '/builder.html',
    terms: ['publier', 'publication', 'mettre en ligne', 'domaine personnalise', 'nom de domaine', 'deploiement'],
    guidance: 'Dans le Builder, « Publier » ouvre le panneau de publication. Il permet de vérifier les contrôles avant mise en ligne puis de gérer le domaine. La publication publique et les domaines personnalisés exigent un abonnement payant actif; un achat de crédits seul ne débloque pas ces droits. Si la publication échoue, indiquez l’état affiché et proposez « Réessayer »; ne dites jamais que le site est en ligne sans confirmation.',
  },
  {
    id: 'settings', route: '/dashboard.html',
    terms: ['parametres', 'preferences', 'profil', 'apparence', 'confidentialite', 'integrations', 'consommation'],
    guidance: 'Ouvrez le menu du compte dans le Dashboard puis « Paramètres ». Les onglets visibles incluent Profil, Personnalisation, Compte et sécurité, Apparence, Facturation, Consommation, Intégrations et Confidentialité. Les préférences sont aussi accessibles depuis le Builder. N’inventez pas une option absente de l’interface.',
  },
  {
    id: 'billing', route: '/pricing.html',
    terms: ['tarif', 'tarifs', 'prix', 'forfait', 'forfaits', 'abonnement', 'credit', 'credits', 'facturation', 'payer', 'recharge', 'recharges', 'quota', 'quotas', 'limite', 'limites', 'gratuit', 'free', 'business', 'pro'],
    guidance: 'Pour comparer les offres, ouvrez Tarifs, ou Paramètres → Facturation pour voir le forfait et le solde du compte connecté. Les prix exacts sont ceux du catalogue public; ne déduisez jamais le solde individuel d’un prix de forfait. Les recharges ponctuelles ne donnent pas les droits de publication.',
  },
  {
    id: 'recovery', route: '/builder.html',
    terms: ['generation interrompue', 'relance disponible', 'preview non verifiee', 'apercu non verifie', 'erreur de generation', 'reessayer'],
    guidance: '« Relance disponible » ou « La génération est interrompue » signifie que le travail peut être conservé mais n’est pas terminé : utilisez « Réessayer ». « Aperçu non vérifié » n’est pas une preuve de fonctionnement; ne publiez pas en le présentant comme validé. Si l’erreur persiste, demandez le message visible et l’identifiant du projet, jamais une clé ou un mot de passe.',
  },
];

function normalize(value: string): string {
  return value.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function billingFacts(): string {
  const proTiers = [25, 60, 100] as const;
  const pro = proTiers.map(credits => `${credits} crédits : ${priceFor('pro', credits, 'monthly').amount.toLocaleString('fr-FR')} FCFA/mois, ${publicationLabel('pro', credits)}`).join('; ');
  return [
    `Free : ${BILLING_PLANS.free.grants.signupCredits} crédits accordés une seule fois, ${publicationLabel('free')}.`,
    `Pro : ${pro}. D’autres paliers existent sur la page Tarifs; vérifier le catalogue avant d’annoncer leur montant.`,
    `Business : à partir de ${priceFor('business', BILLING_PLANS.business.tiers[0], 'monthly').amount.toLocaleString('fr-FR')} FCFA/mois; ${publicationLabel('business')}.`,
    `Coûts indicatifs des actions : style ciblé ${ACTION_CREDIT_PRICES.targeted_style}; composant ${ACTION_CREDIT_PRICES.component}; plan ${ACTION_CREDIT_PRICES.plan}; fonctionnalité ${ACTION_CREDIT_PRICES.feature}; page complète ${ACTION_CREDIT_PRICES.full_page} crédit(s).`,
  ].join(' ');
}

/** Inject only relevant public UI facts; the model must still use verified project/account facts for personal state. */
export function publicProductHelpFor(message: string, previousUserMessage = ''): string {
  const current = ` ${normalize(message)} `;
  const previous = ` ${normalize(previousUserMessage)} `;
  const matches = PUBLIC_HELP_TOPICS.map(topic => ({
    topic,
    score: topic.terms.reduce((score, term) => score + (current.includes(` ${normalize(term)} `) ? 2 : previous.includes(` ${normalize(term)} `) ? 1 : 0), 0),
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  if (!matches.length) return '';
  const topics = matches.map(({ topic }) => `${topic.id} (${topic.route}): ${topic.guidance}`);
  if (matches.some(({ topic }) => topic.id === 'billing')) topics.push(`Catalogue de facturation actuel : ${billingFacts()}`);
  return [`Aide produit publique Coden (version ${CODEN_PRODUCT_HELP_VERSION}; informations de navigation, pas accès aux comptes). N’utiliser ces faits que si la question concerne Coden, jamais pour décrire l’application créée par le client :`, ...topics].join('\n');
}
