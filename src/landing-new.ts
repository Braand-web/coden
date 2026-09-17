import './styles/landing-new.css';
import { mountPromptInput } from './mount-prompt-input';
import { initThemeController } from './theme-controller';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { startCreateProjectFlow, formatCreateProjectFlowStatus, type CreateProjectFlowStatus } from './services/create-project-flow';

function installRevealObserver() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-coden-reveal]'));
  if (!nodes.length) return;
  document.documentElement.dataset.codenReveal = 'on';
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    nodes.forEach(node => node.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries, current) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      current.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -36px' });
  nodes.forEach(node => observer.observe(node));
}

function setupMobileNavigation() {
  const menu = document.querySelector<HTMLButtonElement>('.landing-menu-button');
  const nav = document.querySelector<HTMLElement>('.landing-nav');
  if (!menu || !nav) return;
  const close = () => {
    menu.classList.remove('is-open');
    nav.classList.remove('is-open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Ouvrir la navigation');
  };
  menu.addEventListener('click', () => {
    const open = !nav.classList.contains('is-open');
    menu.classList.toggle('is-open', open);
    nav.classList.toggle('is-open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Fermer la navigation' : 'Ouvrir la navigation');
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', close));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  window.addEventListener('resize', () => { if (window.innerWidth > 900) close(); });
}

function setupFeatureTabs() {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-feature-tab]'));
  if (!tabs.length) return;
  tabs.forEach(tab => tab.addEventListener('click', () => {
    const key = tab.dataset.featureTab;
    tabs.forEach(item => {
      item.setAttribute('aria-selected', String(item === tab));
      item.classList.toggle('is-active', item === tab);
    });
    document.querySelectorAll<HTMLElement>('.landing-feature-panel').forEach(panel => {
      panel.hidden = panel.id !== `feature-panel-${key}`;
    });
  }));
}

function setupPricingCycle() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-pricing-cycle]'));
  const price = document.querySelector<HTMLElement>('[data-price-monthly]');
  const note = document.querySelector<HTMLElement>('[data-price-note]');
  if (!buttons.length || !price) return;
  buttons.forEach(button => button.addEventListener('click', () => {
    const cycle = button.dataset.pricingCycle === 'yearly' ? 'yearly' : 'monthly';
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    const nextPrice = cycle === 'yearly' ? price.dataset.priceYearly : price.dataset.priceMonthly;
    if (nextPrice) price.textContent = nextPrice;
    if (note) note.textContent = cycle === 'yearly' ? 'facturé annuellement, 2 mois offerts' : 'facturation mensuelle';
  }));
}

function setupLandingComposer() {
  const host = document.getElementById('landing-composer');
  const status = document.getElementById('landing-composer-status');
  if (!host) return;
  let busy = false;
  const setStatus = (value: CreateProjectFlowStatus) => {
    if (status) status.textContent = formatCreateProjectFlowStatus(value, 'fr');
  };
  mountPromptInput(host, {
    placeholder: 'Décrivez l’application que vous voulez créer…',
    defaultExpanded: true,
    collapsedWidth: 880,
    expandedWidth: 880,
    isBusy: busy,
    onSubmit: (value, meta) => {
      if (busy) return;
      busy = true;
      setStatus('preparing');
      void startCreateProjectFlow({
        prompt: value,
        model: meta.model,
        effort: meta.effort,
        source: 'landing',
        theme: document.documentElement.dataset.theme || 'light',
      }, { onStatus: setStatus }).catch(() => {
        busy = false;
        if (status) status.textContent = 'Le démarrage a échoué. Votre demande est conservée : réessayez depuis le bouton ci-dessus.';
      });
    },
  });
}

function init() {
  initThemeController();
  initCodenNavigationTransitions();
  setupMobileNavigation();
  setupFeatureTabs();
  setupPricingCycle();
  setupLandingComposer();
  installRevealObserver();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
