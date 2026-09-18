import './styles/landing-new.css';
import { mountPromptInput } from './mount-prompt-input';
import { initThemeController } from './theme-controller';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { CREDIT_TIERS, priceFor, type BillingInterval } from './config/billing-v2';
import { startCreateProjectFlow, formatCreateProjectFlowStatus, type CreateProjectFlowStatus } from './services/create-project-flow';

function installRevealObserver() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-coden-reveal], [data-coden-reveal-item]'));
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
  const section = document.querySelector<HTMLElement>('.landing-product-section');
  let activeIndex = Math.max(0, tabs.findIndex(tab => tab.classList.contains('is-active')));
  let isVisible = false;
  let paused = false;
  let timer: number | undefined;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const selectFeature = (tab: HTMLButtonElement) => {
    const key = tab.dataset.featureTab;
    activeIndex = Math.max(0, tabs.indexOf(tab));
    tabs.forEach(item => {
      item.setAttribute('aria-selected', String(item === tab));
      item.classList.toggle('is-active', item === tab);
    });
    document.querySelectorAll<HTMLElement>('.landing-feature-panel').forEach(panel => {
      panel.hidden = panel.id !== `feature-panel-${key}`;
    });
  };
  const stopTimer = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
  const startTimer = () => {
    if (reducedMotion || !isVisible || paused || timer !== undefined || tabs.length < 2) return;
    timer = window.setInterval(() => selectFeature(tabs[(activeIndex + 1) % tabs.length]), 5200);
  };
  tabs.forEach(tab => tab.addEventListener('click', () => {
    selectFeature(tab);
    stopTimer();
    startTimer();
  }));
  section?.addEventListener('mouseenter', () => { paused = true; stopTimer(); });
  section?.addEventListener('mouseleave', () => { paused = false; startTimer(); });
  section?.addEventListener('focusin', () => { paused = true; stopTimer(); });
  section?.addEventListener('focusout', event => {
    if (section.contains(event.relatedTarget as Node | null)) return;
    paused = false;
    startTimer();
  });
  if (section && 'IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver(([entry]) => {
      isVisible = Boolean(entry?.isIntersecting);
      if (isVisible) startTimer();
      else stopTimer();
    }, { threshold: 0.32 });
    observer.observe(section);
  } else {
    isVisible = true;
    startTimer();
  }
}

function setupPricingCycle() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-pricing-cycle]'));
  const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('[data-pricing-tier]'));
  if (!buttons.length) return;
  let interval: BillingInterval = 'monthly';
  const money = (amount: number) => `${new Intl.NumberFormat('fr-FR').format(amount)} FCFA`;
  const update = () => {
    buttons.forEach(button => {
      const active = (button.dataset.pricingCycle === interval);
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
    selects.forEach(select => {
      const plan = select.dataset.pricingTier;
      if (plan !== 'pro' && plan !== 'business') return;
      const credits = Number(select.value || CREDIT_TIERS[0]);
      const price = priceFor(plan, credits, interval);
      document.querySelector<HTMLElement>(`[data-pricing-price="${plan}"]`)?.replaceChildren(document.createTextNode(money(price.monthlyEquivalent)));
      const note = document.querySelector<HTMLElement>(`[data-pricing-price-note="${plan}"]`);
      if (note) note.textContent = interval === 'annual' ? `Paiement annuel de ${money(price.amount)}` : 'Facturé mensuellement';
      const cta = document.querySelector<HTMLAnchorElement>(`[data-pricing-cta="${plan}"]`);
      if (cta) {
        const query = new URLSearchParams({ settings: 'facturation', plan, interval, credits: String(credits) });
        cta.href = `/auth.html?mode=signup&redirect=${encodeURIComponent(`/dashboard.html?${query.toString()}`)}`;
      }
    });
  };
  buttons.forEach(button => button.addEventListener('click', () => {
    interval = button.dataset.pricingCycle === 'yearly' ? 'annual' : 'monthly';
    update();
  }));
  selects.forEach(select => select.addEventListener('change', update));
  update();
}

function setupTestimonialMotion() {
  const host = document.querySelector<HTMLElement>('[data-testimonial-track]');
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testimonial-card]'));
  if (!host || cards.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  let active = 0;
  let paused = false;
  const setActive = (index: number) => {
    active = index;
    cards.forEach((card, cardIndex) => card.classList.toggle('is-active', cardIndex === active));
  };
  setActive(0);
  const timer = window.setInterval(() => {
    if (!paused) setActive((active + 1) % cards.length);
  }, 4800);
  host.addEventListener('mouseenter', () => { paused = true; });
  host.addEventListener('mouseleave', () => { paused = false; });
  host.addEventListener('focusin', () => { paused = true; });
  host.addEventListener('focusout', event => {
    if (!host.contains(event.relatedTarget as Node | null)) paused = false;
  });
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
}

function setupGalleryDialog() {
  const dialog = document.querySelector<HTMLDialogElement>('#landing-gallery-dialog');
  const trigger = document.querySelector<HTMLButtonElement>('[data-gallery-open]');
  const closeButton = dialog?.querySelector<HTMLButtonElement>('[data-gallery-close]');
  const grid = dialog?.querySelector<HTMLElement>('[data-gallery-grid]');
  if (!dialog || !trigger || !closeButton || !grid) return;

  let populated = false;
  let returnFocus: HTMLElement | null = null;
  const close = () => {
    if (dialog.open) dialog.close();
    returnFocus?.focus();
  };
  const populate = () => {
    if (populated) return;
    document.querySelectorAll<HTMLElement>('.landing-examples-grid .landing-example-card').forEach(card => {
      const clone = card.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-coden-reveal-item');
      grid.appendChild(clone);
    });
    populated = true;
  };

  trigger.addEventListener('click', () => {
    populate();
    returnFocus = trigger;
    dialog.showModal();
    closeButton.focus();
  });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
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
  setupTestimonialMotion();
  setupGalleryDialog();
  setupLandingComposer();
  installRevealObserver();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
