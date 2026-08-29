/**
 * Manual, hand-written French i18n for the dashboard chrome.
 *
 * Mirrors the landing i18n approach: English copy lives in the HTML as the source
 * of truth, hand-written French strings are swapped in on demand, and every managed
 * node is marked `translate="no"` so the browser's auto-translate never mangles the
 * copy. The language choice shares the `coden-lang` key with the landing so it
 * persists across the whole product. No machine translation.
 *
 * This module is intentionally dependency-free so the language toggle keeps working
 * even if the heavier dashboard bundle fails to initialise.
 */

type Lang = 'en' | 'fr';

const STORAGE_KEY = 'coden-lang';

const FR: Record<string, string> = {
  'dash.title': 'Tableau de bord',
  'dash.newConversation': 'Nouvelle conversation',
  'dash.search': 'Rechercher des projets…',
  'dash.newProjectTop': 'Nouveau projet',
  'dash.signIn': 'Se connecter',
  'dash.searchNav': 'Recherche',
  'dash.studioNav': 'Coden Studio',
  'dash.modelsNav': 'Modèles',
  'dash.pluginsNav': 'Plugins',
  'dash.promptTitle': 'Que veux-tu accomplir ?',
  'dash.promptPlaceholder': 'Demander à Coden…',
  'dash.create': 'Créer',
  'dash.workspace': 'Espace de travail',
  'dash.welcomeTitle': 'Construisez la suite, simplement.',
  'dash.welcomeSubtitle': 'Partez d’une idée ou reprenez un projet réel. Coden réunit création, vérification et publication dans un espace concentré.',
  'dash.newProject': 'Nouveau projet',
  'dash.studio': 'Studio',
  'dash.projects': 'Projets',
  'dash.account': 'Compte',
  'dash.openNavigation': 'Ouvrir la navigation',
  'dash.closeNavigation': 'Fermer la navigation',
  'dash.noProjects': 'Aucun projet pour l’instant',
  'dash.promoText': 'Débloquez toute la puissance de l’IA avec le forfait Pro.',
  'dash.upgradePro': 'Améliorer le forfait',
  'dash.connectors': 'Connecteurs',
  'dash.admin': 'Administration',
  'dash.signOut': 'Se déconnecter',
  'dash.plan': 'Forfait',
  'dash.creditsUnit': ' crédits',
  'dash.createTitle': 'Commencez par une idée',
  'dash.createSubtitle': 'Décrivez le résultat attendu. Coden choisit de répondre, planifier ou lancer une construction vérifiée.',
  'dash.emptyTitle': 'Votre espace est calme',
  'dash.emptyDesc': 'Décrivez votre première idée ci-dessus ou ouvrez une nouvelle session du builder.',
  'dash.recentActivity': 'Activité récente',
  'dash.allProjects': 'Tous les projets',
  'dash.noActivity': 'Aucune activité enregistrée pour le moment.',
};

let currentLang: Lang = 'en';

export function getDashboardLang(): Lang {
  return currentLang;
}

function normalizeLang(value: string | null | undefined): Lang | null {
  return value === 'fr' || value === 'en' ? value : null;
}

function resolveInitialLang(): Lang {
  const saved = normalizeLang(localStorage.getItem(STORAGE_KEY));
  if (saved) return saved;
  return (navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function initDashboardI18n(): Lang {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'));
  const source = new Map<string, string>();
  nodes.forEach((node) => {
    const key = node.dataset.i18n;
    if (!key) return;
    // Keep raw text (no trim) so meaningful leading spaces like " credits" survive.
    source.set(key, node.textContent ?? '');
    node.setAttribute('translate', 'no');
    node.classList.add('notranslate');
  });

  const placeholderNodes = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]'),
  );
  const placeholderSource = new Map<string, string>();
  placeholderNodes.forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (key) placeholderSource.set(key, node.placeholder);
  });

  const ariaLabelNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]'));
  const ariaLabelSource = new Map<string, string>();
  ariaLabelNodes.forEach((node) => {
    const key = node.dataset.i18nAriaLabel;
    if (key) ariaLabelSource.set(key, node.getAttribute('aria-label') ?? '');
  });

  const apply = (lang: Lang) => {
    nodes.forEach((node) => {
      const key = node.dataset.i18n;
      if (!key) return;
      const en = source.get(key) ?? '';
      const value = lang === 'fr' ? FR[key] ?? en : en;
      node.textContent = value;
    });
    placeholderNodes.forEach((node) => {
      const key = node.dataset.i18nPlaceholder;
      if (!key) return;
      const en = placeholderSource.get(key) ?? '';
      node.placeholder = lang === 'fr' ? FR[key] ?? en : en;
    });
    ariaLabelNodes.forEach((node) => {
      const key = node.dataset.i18nAriaLabel;
      if (!key) return;
      const en = ariaLabelSource.get(key) ?? '';
      node.setAttribute('aria-label', lang === 'fr' ? FR[key] ?? en : en);
    });
    document.documentElement.lang = lang;
    document.documentElement.dataset.lang = lang;
    currentLang = lang;
  };

  const initial = resolveInitialLang();
  apply(initial);

  const select = document.getElementById('sidebar-lang-select') as HTMLSelectElement | null;
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

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initDashboardI18n());
  } else {
    initDashboardI18n();
  }
}
