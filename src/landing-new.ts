import './styles/landing-new.css';
import { mountPromptInput } from './mount-prompt-input';
import { mountPublicShell } from './public-shell';
import { hasStoredSession } from './lib/stored-session';
import { fetchCurrentPlan, planChoiceHref } from './lib/plan-choice';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { startCreateProjectFlow, formatCreateProjectFlowStatus, type CreateProjectFlowStatus } from './services/create-project-flow';
import {
  readPreferredEffort,
  readPreferredModelSelection,
  writePreferredEffort,
  writePreferredModelSelection,
} from './lib/composer-preferences';
import { BILLING_XAF_PER_USD, priceFor, publicationLimitsFor, type BillingInterval } from './config/billing-v2';

const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/*
 * Run `callback` once, the first time `node` is on screen.
 *
 * Without an observer it runs straight away: the content is never gated on
 * an API the browser may not have.
 */
function onceVisible(node: Element, callback: () => void, threshold = .35) {
  if (!('IntersectionObserver' in window)) { callback(); return; }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    callback();
  }, { threshold });
  observer.observe(node);
}

/*
 * Sections fade in as they arrive.
 *
 * The page only hides them after this has installed the observer, so a
 * failed script leaves a fully visible page. Siblings of the same grid are
 * staggered by 80ms, which is what makes a row of cards read as one gesture.
 */
function installReveal() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-lp-reveal]'));
  if (!nodes.length || reducedMotion() || !('IntersectionObserver' in window)) return;
  nodes.forEach(node => {
    const siblings = Array.from(node.parentElement?.children || []).filter(child => child.hasAttribute('data-lp-reveal'));
    const index = siblings.indexOf(node);
    if (index > 0) node.style.setProperty('--lp-delay', `${index * 80}ms`);
  });
  document.documentElement.dataset.lpReveal = 'on';
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });
  nodes.forEach(node => observer.observe(node));
}

/*
 * A composer: the hero's, and the one that closes the page.
 *
 * Controlled, so that an example can write its brief into it: the value
 * lives here and every change re-renders through `mountPromptInput`, which
 * reconciles instead of remounting — the chosen model and effort survive,
 * and both composers read and write the same stored preference.
 */
function setupComposer(hostId: string, statusId: string) {
  const host = document.getElementById(hostId);
  const status = document.getElementById(statusId);
  if (!host) return { fill: (_value: string) => {} };

  let value = '';
  let busy = false;
  const setStatus = (next: CreateProjectFlowStatus) => {
    if (status) status.textContent = formatCreateProjectFlowStatus(next, 'fr');
  };

  const render = () => {
    mountPromptInput(host, {
      placeholder: 'Décrivez l’application que vous voulez créer…',
      defaultExpanded: true,
      collapsedWidth: 640,
      expandedWidth: 640,
      value,
      onChange: (next) => { value = next; render(); },
      isBusy: busy,
      // Same stored choice as the Dashboard and the Builder.
      defaultModel: readPreferredModelSelection(),
      defaultEffort: readPreferredEffort(),
      onModelChange: writePreferredModelSelection,
      onEffortChange: writePreferredEffort,
      onSubmit: (prompt, meta) => {
        if (busy) return;
        busy = true;
        render();
        setStatus('preparing');
        void startCreateProjectFlow({
          prompt,
          model: meta.model,
          effort: meta.effort,
          source: 'landing',
          theme: document.documentElement.dataset.theme || 'light',
        }, { onStatus: setStatus }).catch(() => {
          busy = false;
          render();
          if (status) status.textContent = 'Le démarrage a échoué. Votre demande est conservée, vous pouvez réessayer.';
        });
      },
    });
  };
  render();

  const fill = (brief: string) => {
    value = brief;
    render();
    host.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    host.classList.remove('is-filled');
    void host.offsetWidth;
    host.classList.add('is-filled');
    window.setTimeout(() => {
      const field = host.querySelector<HTMLTextAreaElement>('textarea');
      field?.focus({ preventScroll: true });
      field?.setSelectionRange(field.value.length, field.value.length);
    }, reducedMotion() ? 0 : 420);
  };
  return { fill };
}

function setupExamples(fill: (brief: string) => void) {
  document.querySelectorAll<HTMLButtonElement>('[data-example-prompt]').forEach(button => {
    button.addEventListener('click', () => fill(button.dataset.examplePrompt || ''));
  });
}

/* Card one types a few briefs in turn while it is on screen. */
function setupTyping() {
  const target = document.querySelector<HTMLElement>('[data-lp-typing]');
  if (!target || reducedMotion()) return;
  const briefs = [
    'Un CRM pour suivre les clients de mon agence',
    'Un site de réservation pour mon restaurant',
    'Un portail client avec factures et messagerie',
  ];
  let brief = 0;
  let length = briefs[0].length;
  let phase: 'hold' | 'deleting' | 'typing' = 'hold';
  let visible = false;
  let timer: number | undefined;
  const tick = () => {
    timer = undefined;
    if (!visible) return;
    let delay = 46;
    if (phase === 'hold') {
      phase = 'deleting';
      delay = 22;
    } else if (phase === 'deleting') {
      length -= 1;
      delay = 22;
      if (length <= 0) { brief = (brief + 1) % briefs.length; phase = 'typing'; delay = 320; }
    } else {
      length += 1;
      if (length >= briefs[brief].length) { phase = 'hold'; delay = 2600; }
    }
    target.textContent = briefs[brief].slice(0, Math.max(0, length));
    timer = window.setTimeout(tick, delay);
  };
  const card = target.closest('.lp-card') || target;
  const observer = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    if (visible && timer === undefined) timer = window.setTimeout(tick, 2400);
  }, { threshold: .4 });
  observer.observe(card);
}

/* The publish panel runs its checks once, when it is first seen. */
function setupPublishChecks() {
  const panel = document.querySelector<HTMLElement>('[data-lp-publish]');
  if (!panel) return;
  const steps = Array.from(panel.querySelectorAll<HTMLElement>('[data-lp-step]'));
  const finish = () => {
    steps.forEach(step => { step.classList.remove('is-running'); step.classList.add('is-done'); });
    panel.classList.add('is-ready');
  };
  if (reducedMotion()) { finish(); return; }
  onceVisible(panel, () => {
    steps.forEach((step, index) => {
      window.setTimeout(() => step.classList.add('is-running'), 300 + index * 900);
      window.setTimeout(() => { step.classList.remove('is-running'); step.classList.add('is-done'); }, 1100 + index * 900);
    });
    window.setTimeout(() => panel.classList.add('is-ready'), 1200 + steps.length * 900);
  }, .5);
}

/*
 * The plans, priced by the same function the server bills from.
 *
 * Settlement is in FCFA; the dollar amount is the catalogue's own conversion
 * (BILLING_XAF_PER_USD), shown for reading and labelled as such.
 */
type DisplayCurrency = 'XAF' | 'USD';
const CURRENCY_STORAGE_KEY = 'coden-display-currency';

/* A price as its two halves: the figure set large, the currency set small. */
function splitAmount(xaf: number, currency: DisplayCurrency) {
  if (currency === 'XAF') {
    return { figure: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(xaf), unit: 'FCFA' };
  }
  const usd = xaf / BILLING_XAF_PER_USD;
  const digits = Number.isInteger(Math.round(usd * 100) / 100) ? 0 : 2;
  return { figure: new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd), unit: '$' };
}

function formatAmount(xaf: number, currency: DisplayCurrency) {
  const { figure, unit } = splitAmount(xaf, currency);
  return `${figure}\u00a0${unit}`;
}

function publicationLabel(credits: number) {
  const { publishedSites, customDomains } = publicationLimitsFor('pro', credits);
  const sites = publishedSites === null ? 'Sites publiés illimités' : `${publishedSites} site${publishedSites > 1 ? 's' : ''} publié${publishedSites > 1 ? 's' : ''}`;
  const domains = customDomains === null ? 'domaines illimités' : `${customDomains} domaine${customDomains > 1 ? 's' : ''} personnalisé${customDomains > 1 ? 's' : ''}`;
  return `${sites} et ${domains}`;
}

/* Slide each toggle's thumb under its pressed option. */
function placeThumbs(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-lp-segmented]').forEach(group => {
    const pressed = group.querySelector<HTMLElement>('button[aria-pressed="true"]');
    if (!pressed) return;
    group.style.setProperty('--thumb-x', `${pressed.offsetLeft}px`);
    group.style.setProperty('--thumb-w', `${pressed.offsetWidth}px`);
  });
}

/*
 * A select, dressed as the product's menus.
 *
 * The native <select> keeps the value — the pricing reads it and listens for
 * its `change` — and this lays a trigger and a listbox over it: arrow keys,
 * Home/End, Enter/Space and Escape as in any listbox, a highlight that travels
 * to the row under the pointer, and each row can carry a line of its own
 * (here, what that tier costs).
 */
const CHECK_ICON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function enhanceSelect(wrapper: HTMLElement, describe: (value: string) => string) {
  const select = wrapper.querySelector('select');
  if (!select) return { refresh: () => {} };
  const id = select.id || `lp-select-${Math.random().toString(36).slice(2)}`;
  const labelId = select.getAttribute('aria-labelledby') || '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'lp-select-trigger';
  trigger.id = `${id}-trigger`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-menu`);
  trigger.setAttribute('aria-labelledby', `${labelId} ${trigger.id}`.trim());
  const triggerLabel = document.createElement('strong');
  const triggerMeta = document.createElement('small');
  trigger.append(triggerLabel, triggerMeta);

  const menu = document.createElement('ul');
  menu.className = 'lp-select-menu';
  menu.id = `${id}-menu`;
  menu.setAttribute('role', 'listbox');
  menu.tabIndex = -1;
  if (labelId) menu.setAttribute('aria-labelledby', labelId);
  menu.hidden = true;
  const highlight = document.createElement('li');
  highlight.className = 'lp-select-highlight';
  highlight.setAttribute('aria-hidden', 'true');
  highlight.setAttribute('role', 'presentation');
  menu.appendChild(highlight);

  const options = Array.from(select.options).map((option, index) => {
    const row = document.createElement('li');
    row.className = 'lp-select-option';
    row.id = `${id}-option-${index}`;
    row.setAttribute('role', 'option');
    row.dataset.value = option.value;
    row.innerHTML = `${CHECK_ICON}<span></span><small></small>`;
    row.querySelector('span')!.textContent = option.textContent || option.value;
    menu.appendChild(row);
    return row;
  });

  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  wrapper.classList.add('is-enhanced');
  wrapper.insertBefore(trigger, select);
  wrapper.appendChild(menu);

  let active = select.selectedIndex;
  const moveHighlight = (index: number) => {
    const row = options[index];
    if (!row) { highlight.style.opacity = '0'; return; }
    highlight.style.transform = `translateY(${row.offsetTop}px)`;
    highlight.style.height = `${row.offsetHeight}px`;
    highlight.style.opacity = '1';
  };
  const setActive = (index: number, scroll = true) => {
    active = Math.max(0, Math.min(options.length - 1, index));
    menu.setAttribute('aria-activedescendant', options[active].id);
    moveHighlight(active);
    if (scroll) options[active].scrollIntoView({ block: 'nearest' });
  };
  const isOpen = () => !menu.hidden;
  const open = () => {
    if (isOpen()) return;
    menu.hidden = false;
    wrapper.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    // Skip the travel on opening: the highlight starts on the chosen row.
    highlight.style.transition = 'none';
    setActive(select.selectedIndex);
    void highlight.offsetWidth;
    highlight.style.transition = '';
    menu.focus({ preventScroll: true });
  };
  const close = (returnFocus = true) => {
    if (!isOpen()) return;
    menu.hidden = true;
    wrapper.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus({ preventScroll: true });
  };
  const choose = (index: number) => {
    if (index !== select.selectedIndex) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
  };

  trigger.addEventListener('click', () => (isOpen() ? close() : open()));
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(); }
  });
  menu.addEventListener('keydown', event => {
    const last = options.length - 1;
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: last, PageDown: active + 5, PageUp: active - 5 };
    if (event.key in moves) { event.preventDefault(); setActive(moves[event.key]); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); return; }
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') close(false);
  });
  menu.addEventListener('pointermove', event => {
    const row = (event.target as Element).closest<HTMLLIElement>('.lp-select-option');
    const index = row ? options.indexOf(row) : -1;
    if (index >= 0 && index !== active) setActive(index, false);
  });
  menu.addEventListener('click', event => {
    const row = (event.target as Element).closest<HTMLLIElement>('.lp-select-option');
    if (row) choose(options.indexOf(row));
  });
  document.addEventListener('pointerdown', event => {
    if (isOpen() && !wrapper.contains(event.target as Node)) close(false);
  });

  const refresh = () => {
    const current = select.options[select.selectedIndex];
    triggerLabel.textContent = current?.textContent || '';
    triggerMeta.textContent = describe(select.value);
    options.forEach((row, index) => {
      row.setAttribute('aria-selected', String(index === select.selectedIndex));
      row.querySelector('small')!.textContent = describe(row.dataset.value || '');
    });
  };
  refresh();
  return { refresh };
}

function setupPricing() {
  const section = document.querySelector<HTMLElement>('[data-lp-pricing]');
  if (!section) return;
  const intervalButtons = Array.from(section.querySelectorAll<HTMLButtonElement>('[data-lp-interval]'));
  const currencyButtons = Array.from(section.querySelectorAll<HTMLButtonElement>('[data-lp-currency]'));
  const tiers = Array.from(section.querySelectorAll<HTMLSelectElement>('[data-lp-tier]'));
  const currencyNote = section.querySelector<HTMLElement>('[data-lp-currency-note]');

  let interval: BillingInterval = 'monthly';
  let currency: DisplayCurrency = 'XAF';
  let signedIn = hasStoredSession();
  let currentPlan: string | null = null;
  const ctaFor = (plan: string) => section.querySelector<HTMLAnchorElement>(
    plan === 'free' ? 'a[data-conversion-event="pricing_start_free"]' : `a[data-conversion-plan="${plan}"]`,
  );
  /*
   * The offer buttons carry the choice — plan, credits, interval — to the
   * dashboard's billing, through sign-up for a visitor. They used to lead to
   * a bare sign-up and the choice was lost on the way.
   */
  const updateCtas = () => {
    const free = ctaFor('free');
    if (free) {
      free.href = planChoiceHref({ plan: 'free', interval }, signedIn);
      free.textContent = signedIn ? (currentPlan === 'free' ? 'Mon espace' : 'Ouvrir mon espace') : 'Créer mon espace';
    }
    tiers.forEach(select => {
      const plan = select.dataset.lpTier === 'business' ? 'business' : 'pro';
      const cta = ctaFor(plan);
      if (!cta) return;
      const current = signedIn && currentPlan === plan;
      cta.href = current ? '/dashboard.html?settings=facturation' : planChoiceHref({ plan, credits: Number(select.value), interval }, signedIn);
      cta.textContent = current ? 'Gérer mon abonnement' : `Choisir ${plan === 'business' ? 'Business' : 'Pro'}`;
      cta.closest('.lp-plan')?.classList.toggle('is-current-plan', current);
    });
  };
  try {
    if (localStorage.getItem(CURRENCY_STORAGE_KEY) === 'USD') currency = 'USD';
  } catch { /* the default currency is fine */ }

  const dropdowns = tiers.map(select => {
    const plan = select.dataset.lpTier === 'business' ? 'business' : 'pro';
    const wrapper = select.closest<HTMLElement>('[data-lp-select]');
    return wrapper
      ? enhanceSelect(wrapper, value => `${formatAmount(priceFor(plan, Number(value), interval).monthlyEquivalent, currency)} / mois`)
      : { refresh: () => {} };
  });

  const setText = (node: Element | null, text: string, animate: boolean) => {
    if (!node || node.textContent === text) return;
    node.textContent = text;
    if (!animate || reducedMotion()) return;
    node.classList.remove('lp-price-swap');
    void (node as HTMLElement).offsetWidth;
    node.classList.add('lp-price-swap');
  };
  const show = (node: HTMLElement | null, text: string | null) => {
    if (!node) return;
    node.hidden = !text;
    if (text) node.textContent = text;
  };

  const render = (animate = true) => {
    intervalButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lpInterval === interval)));
    currencyButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lpCurrency === currency)));
    placeThumbs(section);
    section.querySelectorAll('[data-lp-unit]').forEach(node => { node.textContent = currency === 'XAF' ? 'FCFA' : '$'; });
    setText(section.querySelector('[data-lp-amount="free"]'), splitAmount(0, currency).figure, animate);
    tiers.forEach(select => {
      const plan = select.dataset.lpTier === 'business' ? 'business' : 'pro';
      const price = priceFor(plan, Number(select.value), interval);
      const monthly = priceFor(plan, price.credits, 'monthly');
      const annual = interval === 'annual';
      setText(section.querySelector(`[data-lp-amount="${plan}"]`), splitAmount(price.monthlyEquivalent, currency).figure, animate);
      show(section.querySelector<HTMLElement>(`[data-lp-was="${plan}"]`), annual ? `${formatAmount(monthly.amount, currency)} / mois` : null);
      setText(section.querySelector(`[data-lp-note="${plan}"]`), annual ? `${formatAmount(price.amount, currency)} facturés par an` : 'Facturé mensuellement', false);
      show(section.querySelector<HTMLElement>(`[data-lp-save="${plan}"]`), annual ? `Économie de ${formatAmount(monthly.amount * 12 - price.amount, currency)}` : null);
      if (plan === 'pro') setText(section.querySelector('[data-lp-publication="pro"] span'), publicationLabel(price.credits), false);
    });
    dropdowns.forEach(dropdown => dropdown.refresh());
    updateCtas();
    if (currencyNote) {
      currencyNote.textContent = currency === 'USD'
        ? `Montants en dollars indicatifs (1 $ = ${BILLING_XAF_PER_USD} FCFA). Paiement en FCFA via un checkout Saspay sécurisé.`
        : 'Paiement en FCFA via un checkout Saspay sécurisé.';
    }
  };

  intervalButtons.forEach(button => button.addEventListener('click', () => {
    interval = button.dataset.lpInterval === 'annual' ? 'annual' : 'monthly';
    render();
  }));
  currencyButtons.forEach(button => button.addEventListener('click', () => {
    currency = button.dataset.lpCurrency === 'USD' ? 'USD' : 'XAF';
    try { localStorage.setItem(CURRENCY_STORAGE_KEY, currency); } catch { /* not remembered, still applied */ }
    render();
  }));
  tiers.forEach(select => select.addEventListener('change', () => render()));
  // The thumbs are measured, so they follow the fonts and the layout.
  if ('ResizeObserver' in window) new ResizeObserver(() => placeThumbs(section)).observe(section);
  void document.fonts?.ready.then(() => placeThumbs(section));
  render(false);
  void fetchCurrentPlan().then(plan => {
    if (!plan) return;
    signedIn = true;
    currentPlan = plan;
    updateCtas();
  });
}

function init() {
  mountPublicShell();
  initCodenNavigationTransitions();
  const { fill } = setupComposer('landing-composer', 'landing-composer-status');
  setupComposer('landing-final-composer', 'landing-final-composer-status');
  setupExamples(fill);
  setupTyping();
  setupPublishChecks();
  setupPricing();
  installReveal();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
