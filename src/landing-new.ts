import './styles/landing-new.css';
import { mountPromptInput } from './mount-prompt-input';
import { initThemeController } from './theme-controller';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { startCreateProjectFlow, formatCreateProjectFlowStatus, type CreateProjectFlowStatus } from './services/create-project-flow';
import {
  readPreferredEffort,
  readPreferredModelSelection,
  writePreferredEffort,
  writePreferredModelSelection,
} from './lib/composer-preferences';

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

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    populate();
    returnFocus = trigger;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
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
  const mount = (hostId: string, statusId: string) => {
    const host = document.getElementById(hostId);
    const status = document.getElementById(statusId);
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
      // Keep the selected model and effort consistent across both landing composers.
      defaultModel: readPreferredModelSelection(),
      defaultEffort: readPreferredEffort(),
      onModelChange: writePreferredModelSelection,
      onEffortChange: writePreferredEffort,
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
  };
  mount('landing-composer', 'landing-composer-status');
  mount('landing-final-composer', 'landing-final-composer-status');
}

function init() {
  initThemeController();
  initCodenNavigationTransitions();
  setupMobileNavigation();
  setupFeatureTabs();
  setupTestimonialMotion();
  setupGalleryDialog();
  setupLandingComposer();
  installRevealObserver();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
