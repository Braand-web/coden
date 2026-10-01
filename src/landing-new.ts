import './styles/landing-new.css';
import { mountPromptInput } from './mount-prompt-input';
import { mountPublicShell } from './public-shell';
import { hasStoredSession } from './lib/stored-session';
import { fetchCurrentPlan, planChoiceHref } from './lib/plan-choice';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { startCreateProjectFlow, formatCreateProjectFlowStatus, type CreateProjectFlowStatus } from './services/create-project-flow';
import type { AttachmentUploader } from './lib/attachment-types';
import { stashPendingFiles } from './lib/pending-files';
import { mountBrandMesh, type BrandMeshVariant } from './lib/brand-mesh';
import { enhanceSelect, type SelectMenu } from './lib/select-menu';
import { installMeshParallax, installPointerLight, installReadingProgress } from './lib/page-motion';
import './styles/public-alive.css';
import { createLandingDraft } from './lib/landing-draft';
import { readPreferredEffort, readPreferredModelSelection, writePreferredEffort, writePreferredModelSelection } from './lib/composer-preferences';
import { ANNUAL_DISCOUNT, BILLING_PLANS, planFeatures, priceFor, type BillingInterval } from './config/billing-v2';

function setupComposers() {
  let storage: Storage | undefined;
  try { storage = window.sessionStorage; } catch { /* the shared live draft still works */ }
  const draft = createLandingDraft(storage);
  let model = readPreferredModelSelection();
  let effort = readPreferredEffort();
  let uploader: AttachmentUploader | null = null;
  const pairs = [
    ['landing-composer', 'landing-composer-status'],
    ['landing-final-composer', 'landing-final-composer-status'],
  ].map(([hostId, statusId]) => ({ host: document.getElementById(hostId), status: document.getElementById(statusId) }));
  const setStatus = (text: string) => pairs.forEach(({ status }) => { if (status) status.textContent = text; });
  const onStatus = (status: CreateProjectFlowStatus) => setStatus(formatCreateProjectFlowStatus(status, 'fr'));
  const render = () => pairs.forEach(({ host }) => {
    if (!host) return;
    host.setAttribute('aria-busy', String(draft.busy));
    mountPromptInput(host, {
      placeholder: 'Décrivez votre application…',
      defaultExpanded: true,
      collapsedWidth: 560,
      expandedWidth: 560,
      value: draft.value,
      onChange: next => draft.setValue(next),
      isBusy: draft.busy,
      disabled: draft.busy,
      model,
      effort,
      onModelChange: next => { model = writePreferredModelSelection(next); render(); },
      onEffortChange: next => { effort = writePreferredEffort(next); render(); },
      uploader,
      onSubmit: (prompt, meta) => {
        if (!prompt.trim() || !draft.beginSubmit()) return;
        onStatus('preparing');
        void (async () => {
          if (meta.attachments.length) await stashPendingFiles(meta.attachments);
          await startCreateProjectFlow({
            prompt, model: meta.model, effort: meta.effort, source: 'landing',
            theme: document.documentElement.dataset.theme || 'light',
            attachmentIds: [...meta.attachmentIds, ...meta.linkIds],
            skippedUrls: meta.skippedUrls,
            pendingFiles: meta.attachments.length > 0,
          }, { onStatus });
          // Keep the draft until handoff succeeds; no speculative erase on send.
        })().catch(() => {
          draft.releaseSubmit();
          setStatus('Votre demande est conservée. Le démarrage est indisponible pour le moment, réessayez.');
        });
      },
    });
  });
  draft.subscribe(render);
  render();
  if (hasStoredSession()) {
    void import('./lib/attachment-client').then(({ createAttachmentUploader }) => {
      uploader = createAttachmentUploader();
      render();
    }).catch(() => undefined);
  }
}

/** Counts a price up or down to its new value, so a change of tier or period is felt, not just swapped. */
function tweenText(node: Element, to: number, format: (value: number) => string) {
  const el = node as HTMLElement;
  const from = Number(el.dataset.value ?? to);
  el.dataset.value = String(to);
  if (from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = format(to); return; }
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / 420);
    el.textContent = format(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1 && el.dataset.value === String(to)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupPricing() {
  const section = document.querySelector<HTMLElement>('[data-lp-pricing]');
  if (!section) return;
  let interval: BillingInterval = 'monthly';
  let currentPlan: string | null = null;
  let signedIn = hasStoredSession();
  const chosen: Partial<Record<'pro' | 'business', number>> = {};
  const menus: SelectMenu[] = [];
  const format = (amount: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount);
  section.querySelector('[data-lp-discount]')!.textContent = '−' + format(ANNUAL_DISCOUNT * 100) + ' %';
  const render = () => {
    section.querySelectorAll<HTMLButtonElement>('[data-lp-interval]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.lpInterval === interval));
    });
    for (const plan of ['free', 'pro', 'business'] as const) {
      const credits = plan === 'free'
        ? (BILLING_PLANS[plan].tiers[0] ?? BILLING_PLANS[plan].baseCredits)
        : (chosen[plan] ?? BILLING_PLANS[plan].tiers[0] ?? BILLING_PLANS[plan].baseCredits);
      const cta = section.querySelector<HTMLAnchorElement>('[data-lp-plan-cta="' + plan + '"]');
      if (cta) {
        cta.href = currentPlan === plan && signedIn ? '/dashboard.html?settings=facturation' : planChoiceHref({ plan, credits, interval }, signedIn);
        cta.textContent = plan === 'free' ? (signedIn ? 'Ouvrir mon espace' : 'Créer mon application') : (currentPlan === plan ? 'Gérer mon abonnement' : 'Choisir ' + BILLING_PLANS[plan].name);
      }
      if (plan === 'free') continue;
      const price = priceFor(plan, credits, interval);
      tweenText(section.querySelector('[data-lp-amount="' + plan + '"]')!, price.monthlyEquivalent, format);
      const unit = section.querySelector('[data-lp-plan="' + plan + '"] [data-lp-unit]');
      if (unit) unit.textContent = interval === 'annual' ? '/ mois, facturé par an' : '/ mois';
      section.querySelector('[data-lp-note="' + plan + '"]')!.textContent = interval === 'annual'
        ? format(price.amount) + ' FCFA facturés par an' : format(credits) + ' crédits par mois';
      const list = section.querySelector('[data-lp-features="' + plan + '"]');
      list?.replaceChildren(...planFeatures(plan, credits).slice(0, 3).map(feature => {
        const li = document.createElement('li');
        li.textContent = feature;
        return li;
      }));
    }
    menus.forEach(menu => menu.refresh());
  };
  // The credit tiers come from the catalogue, never typed twice: each row carries its monthly price.
  section.querySelectorAll<HTMLSelectElement>('[data-lp-tier]').forEach(select => {
    const plan = select.dataset.lpTier === 'business' ? 'business' : 'pro';
    select.replaceChildren(...BILLING_PLANS[plan].tiers.map(credits => {
      const option = document.createElement('option');
      option.value = String(credits);
      option.textContent = format(credits) + ' crédits';
      return option;
    }));
    select.value = String(BILLING_PLANS[plan].tiers[0]);
    select.addEventListener('change', () => { chosen[plan] = Number(select.value); render(); });
    menus.push(enhanceSelect(select, { describe: value => format(priceFor(plan, Number(value), 'monthly').monthlyEquivalent) + ' FCFA / mois' }));
    select.closest<HTMLElement>('.lp-tier')?.removeAttribute('hidden');
  });
  section.querySelectorAll<HTMLButtonElement>('[data-lp-interval]').forEach(button => button.addEventListener('click', () => {
    interval = button.dataset.lpInterval === 'annual' ? 'annual' : 'monthly';
    render();
  }));
  render();
  void fetchCurrentPlan().then(plan => { if (plan) { signedIn = true; currentPlan = plan; render(); } }).catch(() => undefined);
}

function setupMarquee() {
  const marquee = document.querySelector<HTMLElement>('.lp-marquee');
  const belt = marquee?.querySelector('.lp-marquee-belt');
  const track = belt?.querySelector('.lp-marquee-track');
  const toggle = document.querySelector<HTMLButtonElement>('.lp-marquee-toggle');
  if (!marquee || !belt || !track || !toggle) return;
  // Exact duplicate gives a seamless loop, with no duplicate accessible names.
  const clone = track.cloneNode(true) as HTMLElement;
  clone.setAttribute('aria-hidden', 'true');
  clone.inert = true;
  belt.append(clone);
  let userPaused = false;
  let onScreen = true;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const update = () => {
    marquee.dataset.paused = String(userPaused || !onScreen || document.hidden || motion.matches);
    toggle.setAttribute('aria-pressed', String(userPaused));
    toggle.textContent = userPaused ? 'Reprendre le défilement' : 'Mettre en pause';
  };
  toggle.addEventListener('click', () => { userPaused = !userPaused; update(); });
  document.addEventListener('visibilitychange', update);
  motion.addEventListener('change', update);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => { onScreen = entries.some(entry => entry.isIntersecting); update(); });
    observer.observe(marquee);
  }
  update();
  marquee.dataset.ready = 'true';
}

function setupReveal() {
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const nodes = [...document.querySelectorAll<HTMLElement>('[data-lp-reveal]')];
  document.querySelectorAll<HTMLElement>('[data-lp-words]').forEach(heading => {
    const words = (heading.textContent || '').trim().split(/\s+/);
    heading.textContent = '';
    words.forEach((word, index) => {
      if (index) heading.append(' ');
      const span = document.createElement('span');
      span.className = 'lp-word';
      span.style.setProperty('--i', String(index));
      span.textContent = word;
      heading.append(span);
    });
  });
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    observer.unobserve(entry.target);
    window.setTimeout(() => entry.target.removeAttribute('data-lp-reveal'), 900);
  }), { rootMargin: '0px 0px -24px 0px', threshold: 0 });
  // Siblings rise one after the other.
  nodes.forEach(node => { const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(child => child.hasAttribute('data-lp-reveal')) : []; node.style.setProperty('--si', String(Math.max(0, siblings.indexOf(node)))); });
  nodes.forEach(node => observer.observe(node));
  // Opt in only once the observer is installed. No JS means visible content.
  document.documentElement.dataset.lpReveal = 'on';
}

function setupMesh() {
  document.querySelectorAll<HTMLElement>('[data-lp-mesh]').forEach(host => mountBrandMesh(host, host.dataset.lpMesh as BrandMeshVariant));
}

function init() {
  mountPublicShell();
  initCodenNavigationTransitions();
  setupComposers();
  setupPricing();
  setupMarquee();
  setupReveal();
  setupMesh();
  installPointerLight('.lp-card, .lp-plan, .lp-workspace');
  installReadingProgress();
  installMeshParallax();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
