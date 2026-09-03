/**
 * Manual, hand-written i18n for the public landing page.
 *
 * The product is English-first (and the SEO block is English), so the English
 * copy lives directly in index.html and acts as the source of truth. This module
 * captures that source, then swaps in carefully hand-translated French strings —
 * never machine translation — when the visitor picks French or their browser is
 * French by default.
 *
 * We also mark every managed node with `translate="no"` so browser auto-translate
 * never mangles the copy on top of our own translations.
 */

import { getProductPositioning } from './product-positioning';

type Lang = 'en' | 'fr';

const STORAGE_KEY = 'coden-lang';

/** Hand-written French copy, keyed by `data-i18n`. Premium tone, not word-for-word. */
const FR_POSITIONING = getProductPositioning('fr');

const FR: Record<string, string> = {
  // Navigation
  'nav.discover': 'Découvrir',
  'nav.features': 'Fonctionnalités',
  'nav.documentation': 'Documentation',
  'nav.pricing': 'Tarifs',
  'nav.showcase': 'Showcase',
  'nav.cta': 'Créer mon application',
  'nav.open': 'Ouvrir la navigation',
  'nav.close': 'Fermer la navigation',

  // Hero
  // The markup emphasises the noun; French emphasises the same noun rather
  // than dropping to a flat sentence.
  'hero.title': 'De l’idée à l’<em>application web</em>.',
  'hero.badge': 'Construire, vérifier, publier',
  'hero.seed1': 'Un tableau de bord SaaS avec authentification et facturation',
  'hero.seed2': 'Un outil de réservation avec créneaux et confirmations',
  'hero.seed3': 'Une boutique en ligne avec panier et paiement',
  'hero.subtitle': FR_POSITIONING.heroSubtitle,
  'hero.placeholder': FR_POSITIONING.promptPlaceholder,
  'hero.cta': FR_POSITIONING.primaryCta,
  'hero.reassurance': 'Commencez gratuitement. Aucun paiement requis pour créer votre premier prototype.',
  'hero.preview': FR_POSITIONING.previewLabel,
  'hero.refine': FR_POSITIONING.refineLabel,
  'hero.publish': FR_POSITIONING.publishLabel,
  'hero.import': 'ou importez depuis',

  // Run pipeline shown in the hero. These are the labels the generator really
  // emits — kept identical to LABELS in src/services/generation-phases.ts.
  'run.p1': 'Analyse de votre demande',
  'run.p2': 'Choix de l’approche',
  'run.p3': 'Plan de l’application',
  'run.p4': 'Création de l’application',
  'run.p5': 'Vérification de l’application',
  'run.p6': 'Correction des problèmes détectés',
  'run.p7': 'Vérification de l’application',
  'run.p8': 'Application prête',

  // The loop
  'loop.kicker': 'La boucle',
  'loop.title': 'Décrivez, regardez construire, corrigez, publiez.',
  'loop.lede': 'Chaque message suit les quatre mêmes temps. Rien n’est regénéré depuis zéro : Coden garde le projet qu’il a déjà construit.',
  'loop.s1.title': 'Décrire',
  'loop.s1.text': 'Écrivez ce que vous voulez en langage naturel. Coden relit le projet existant avant de modifier quoi que ce soit.',
  'loop.s2.title': 'Construire',
  'loop.s2.text': 'Un vrai projet React et TypeScript est écrit fichier par fichier, et l’aperçu se met à jour au fil de la construction.',
  'loop.s3.title': 'Vérifier',
  'loop.s3.text': 'L’application est compilée et contrôlée. En cas d’erreur, Coden répare les fichiers nommés par le build — pas toute l’application.',
  'loop.s4.title': 'Publier',
  'loop.s4.text': 'Un clic met la version vérifiée en ligne sur Cloudflare. Vos visiteurs ne voient jamais de travail inachevé.',

  // Capabilities
  'cap.kicker': 'Ce que vous obtenez',
  'cap.title': 'Une application qui fonctionne, pas une maquette.',
  'cap.lede': 'Quatre choses que Coden fait de bout en bout. Chacune existe déjà dans le produit.',
  'cap.c1.title': 'Un aperçu qui s’exécute vraiment',
  'cap.c1.text': 'Votre application est compilée et exécutée dans le navigateur, avec ses routes, son état et ses styles. C’est l’application, pas une capture.',
  'cap.c2.title': 'Les erreurs corrigées avant vous',
  'cap.c2.text': 'Quand le build échoue, Coden lit la sortie du compilateur, répare les fichiers qu’elle désigne, puis vérifie à nouveau — automatiquement.',
  'cap.c3.title': 'Publié sur Cloudflare',
  'cap.c3.text': 'La publication met la version vérifiée sur le réseau Cloudflare, servie depuis une URL en ligne dès la fin du déploiement.',
  'cap.c4.title': 'Votre propre domaine',
  'cap.c4.text': 'Pointez votre domaine vers l’application et suivez chaque étape — vérification DNS, propagation, actif — sans quitter le panneau Publier.',

  // Partners / integrations strip
  'partners.heading': 'Compatible avec les outils que vous utilisez déjà.',

  // Manifesto
  'manifest.kicker': 'Notre conviction',
  'manifest.quote': '« Nous sommes convaincus que l’avenir du logiciel ne tient pas qu’au code : il s’agit de rendre la création accessible à tous ceux qui ont une histoire à raconter. »',
  'manifest.attrib': '— L’équipe Coden',

  // Workflow
  'workflow.title': 'De l’idée à l’application en ligne, en trois temps.',
  'workflow.subtitle': 'Coden garde le chemin simple : décrivez, regardez l’app prendre vie, affinez puis publiez.',
  'workflow.s1.title': 'Partez d’une idée',
  'workflow.s1.text': 'Décrivez l’application souhaitée en langage naturel — ou déposez une capture, un dépôt ou une URL.',
  'workflow.s2.title': 'Regardez-la prendre vie',
  'workflow.s2.text': 'Coden génère une vraie application React et affiche l’aperçu fonctionnel au fil de la construction.',
  'workflow.s3.title': 'Affinez et publiez',
  'workflow.s3.text': 'Demandez vos modifications dans le chat — Coden édite le projet — puis publiez en un clic.',

  // Discover
  'discover.kicker': 'Découvrir',
  'discover.title': 'Des applications web créées avec Coden.',
  'discover.desc': 'Des aperçus courts, lisibles et concrets du type de résultats que Coden peut produire.',
  'discover.viewall': 'Voir tout',
  'discover.cat.productivity': 'Productivité',
  'discover.cat.booking': 'Réservation',
  'discover.cat.saas': 'SaaS',
  'discover.cat.commerce': 'Commerce',
  'discover.cat.restaurant': 'Restaurant',
  'discover.cat.education': 'Éducation',
  'discover.card.todo': 'Gestion de tâches : ajout, complétion, filtres et stockage local.',
  'discover.card.bookly': 'Disponibilités, formulaire client, confirmation et états clairs.',
  'discover.card.metric': 'Cartes, graphiques, barre latérale, onboarding et publication.',
  'discover.card.cartly': 'Grille produits, états du panier, retours de paiement et UI responsive.',
  'discover.card.menukit': 'Menu, plats du jour, appel à réserver et mise en page mobile-first.',
  'discover.card.classhub': 'Tableau de cours, cartes de progression et états pensés pour l’apprenant.',
  'discover.card.portal': 'Connexion, projets, factures et un tableau de bord épuré.',
  'discover.card.storefront': 'Catalogue, pages produit, panier et un parcours prêt pour le paiement.',

  // Discover page (/discover.html)
  'discoverPage.title': 'Des applications créées avec Coden.',
  'discoverPage.subtitle': 'Parcourez par catégorie. Des modèles pour démarrer, et des projets de la communauté partagés par leurs auteurs.',
  'discoverPage.all': 'Tout',
  'discoverPage.community': 'Vitrine de la communauté',
  'discoverPage.templates': 'Partez d’un modèle',
  'discoverPage.cta': 'Créez la vôtre',

  // Pricing
  'pricing.kicker': 'Tarifs',
  'pricing.title': 'Commencez gratuitement. Publiez quand vous êtes prêt.',
  'pricing.subtitle': 'Gratuit pour valider l’idée. Pro pour publier. Scale pour construire en équipe.',
  'pricing.free.name': 'Gratuit',
  'pricing.free.benefit': 'Validez votre idée',
  'pricing.free.cta': 'Créer mon prototype',
  'pricing.free.f1': '50 crédits de démarrage',
  'pricing.free.f2': '1 projet actif',
  'pricing.free.f3': 'Aperçu en direct pendant la création',
  'pricing.free.f4': '1 $ d’hébergement inclus',
  'pricing.free.f5': 'Sous-domaine Coden',
  'pricing.pro.badge': 'Le plus populaire',
  'pricing.pro.name': 'Pro',
  'pricing.pro.benefit': 'Publiez de vraies applications',
  'pricing.pro.cta': 'Publier mon application',
  'pricing.pro.f1': '1 000 crédits / mois',
  'pricing.pro.f2': '10 projets actifs, 3 publiés',
  'pricing.pro.f3': '10 $ d’hébergement inclus',
  'pricing.pro.f4': 'Domaine personnalisé et retrait du badge',
  'pricing.pro.f5': 'Déploiement, export, versions, rollback',
  'pricing.scale.name': 'Scale',
  'pricing.scale.benefit': 'Plus de contrôle pour les équipes',
  'pricing.scale.cta': 'Construire avec mon équipe',
  'pricing.scale.f1': '10 000 crédits / mois',
  'pricing.scale.f2': 'Brouillons illimités, 25 publiés',
  'pricing.scale.f3': '75 $ d’hébergement inclus',
  'pricing.scale.f4': 'Espace d’équipe et rôles',
  'pricing.scale.f5': 'Support prioritaire et modèles premium',
  'pricing.unit': '/mois',
  'pricing.link': 'Comparer les forfaits et la facturation →',

  // FAQ
  'faq.kicker': 'FAQ',
  'faq.title': 'Les questions avant de vous lancer.',
  'faq.q1': 'Que peut construire Coden ?',
  'faq.a1': 'Des produits web : tableaux de bord SaaS, portails, outils de réservation, e‑commerce, outils internes et pages d’atterrissage. Coden ouvre un espace de création et transforme votre idée en aperçu fonctionnel, puis en application publiable.',
  'faq.q2': 'De vraies apps ou de simples maquettes ?',
  'faq.a2': 'De vraies apps. Pour une demande d’application, Coden génère de vrais projets React, TypeScript et Vite — avec fichiers, styles, interactions et aperçu en direct — pas de simples maquettes.',
  'faq.q3': 'Comment fonctionnent les crédits et les forfaits ?',
  'faq.a3': 'Les crédits servent à créer et améliorer vos applications avec l’IA. Les forfaits payants incluent plus de crédits et des limites plus élevées. Le cloud, le stockage et l’usage de l’IA déployée sont comptabilisés à part à mesure que vos apps grandissent.',
  'faq.q4': 'Quelle différence entre l’aperçu et la publication ?',
  'faq.a4': 'L’aperçu sert à inspecter et itérer en toute sécurité. Votre site en ligne ne change qu’au moment où vous cliquez sur Publier : vos visiteurs ne voient jamais de travail inachevé.',
  'faq.q5': 'Mes données sont-elles protégées ?',
  'faq.a5': 'Les clés des fournisseurs et les jetons privés n’apparaissent jamais dans le code frontend généré. Les secrets côté serveur restent dans des environnements sécurisés, et les actions sensibles restent confirmées et protégées côté serveur.',

  // Footer
  'footer.tagline': 'De l’idée au produit web vérifié.',
  'footer.cta': 'Commencez par votre idée.',
  'footer.ctaTitle': 'Votre idée mérite un premier prototype.',
  'footer.ctaButton': 'Créer mon application',
  'footer.col.company': 'Entreprise',
  'footer.link.about': 'À propos',
  'footer.link.careers': 'Carrières',
  'footer.link.enterprise': 'Entreprises',
  'footer.col.product': 'Produit',
  'footer.link.features': 'Fonctionnalités',
  'footer.link.showcase': 'Showcase',
  'footer.link.pricing': 'Tarifs',
  'footer.col.solutions': 'Solutions',
  'footer.link.templates': 'Modèles',
  'footer.link.guides': 'Guides',
  'footer.link.teams': 'Pour les équipes',
  'footer.link.agencies': 'Pour les agences',
  'footer.col.resources': 'Ressources',
  'footer.link.documentation': 'Documentation',
  'footer.link.api': 'Référence API',
  'footer.link.blog': 'Blog',
  'footer.col.legal': 'Légal',
  'footer.link.privacy': 'Confidentialité',
  'footer.link.security': 'Sécurité',
  'footer.link.terms': 'Conditions',
  'footer.link.cookies': 'Cookies',
  'footer.link.status': 'Confiance et sécurité',
  'footer.link.contact': 'Contact',
  'footer.col.community': 'Communauté',
  'footer.link.community': 'Communauté',
  'footer.lang': 'Langue',
};

let currentLang: Lang = 'en';

export function getLandingLang(): Lang {
  return currentLang;
}

function normalizeLang(value: string | null | undefined): Lang | null {
  if (value === 'fr' || value === 'en') return value;
  return null;
}

function resolveInitialLang(): Lang {
  const saved = normalizeLang(localStorage.getItem(STORAGE_KEY));
  if (saved) return saved;
  const nav = (navigator.language || '').toLowerCase();
  return nav.startsWith('fr') ? 'fr' : 'en';
}

/**
 * Initialise landing i18n. Must run before the scroll-text-reveal splitter so the
 * manifesto is split from already-translated text. Switching language reloads the
 * page (cheap and bullet-proof: avoids re-rendering split reveals and JS-set labels).
 */
export function initLandingI18n(): Lang {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'));

  // Capture the English source straight from the DOM, keyed by data-i18n.
  const source = new Map<string, string>();
  nodes.forEach((node) => {
    const key = node.dataset.i18n;
    if (!key) return;
    const usesHtml = node.children.length > 0 || (FR[key] ?? '').includes('<');
    source.set(key, usesHtml ? node.innerHTML.trim() : (node.textContent ?? '').trim());
    node.setAttribute('translate', 'no');
    node.classList.add('notranslate');
  });

  const placeholderNodes = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]'),
  );
  const placeholderSource = new Map<string, string>();
  placeholderNodes.forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (!key) return;
    placeholderSource.set(key, node.placeholder);
  });

  const apply = (lang: Lang) => {
    nodes.forEach((node) => {
      const key = node.dataset.i18n;
      if (!key) return;
      const en = source.get(key) ?? '';
      const value = lang === 'fr' ? FR[key] ?? en : en;
      if (!value) return;
      const usesHtml = value.includes('<') || en.includes('<');
      if (usesHtml) {
        node.innerHTML = value;
      } else {
        node.textContent = value;
      }
    });
    placeholderNodes.forEach((node) => {
      const key = node.dataset.i18nPlaceholder;
      if (!key) return;
      const en = placeholderSource.get(key) ?? '';
      node.placeholder = lang === 'fr' ? FR[key] ?? en : en;
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((node) => {
      const key = node.dataset.i18nAriaLabel;
      if (!key) return;
      const englishAria: Record<string, string> = {
        'nav.open': 'Open navigation',
        'nav.close': 'Close navigation',
      };
      const value = lang === 'fr' ? FR[key] ?? key : englishAria[key] ?? source.get(key) ?? key;
      node.setAttribute('aria-label', value);
      node.setAttribute('title', value);
    });
    document.documentElement.lang = lang;
    document.documentElement.dataset.lang = lang;
    currentLang = lang;
  };

  const initial = resolveInitialLang();
  apply(initial);

  const select = document.getElementById('lang-select') as HTMLSelectElement | null;
  if (select) {
    select.value = initial;
    select.addEventListener('change', () => {
      const next = normalizeLang(select.value) ?? 'en';
      localStorage.setItem(STORAGE_KEY, next);
      if (next === currentLang) return;
      window.location.reload();
    });
  }

  return initial;
}
