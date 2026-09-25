/**
 * Two overlays that end on the paid plans:
 *
 * - the Upgrade modal, opened from the dashboard sidebar;
 * - the welcome onboarding, four one-tap questions after sign-up, then the
 *   plans with "Continuer avec Free" always one click away.
 *
 * Both are plain DOM on top of whatever page opens them, trap focus while
 * open, close on Escape, and give focus back where it was.
 */
import { renderPlanChooser } from './plan-chooser';
import { codenLogoSvg } from '../lib/coden-logo';
import {
  ONBOARDING_STEPS,
  ONBOARDING_VERSION,
  recommendPlan,
  sanitizeAnswers,
  type OnboardingAnswers,
  type OnboardingRecord,
} from '../lib/onboarding-state';
import '../styles/upgrade-flows.css';

const ICONS: Record<string, string> = {
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M9 11a14 14 0 0 1 11-8 14 14 0 0 1-8 11l-3 1-1-1z"/><circle cx="15" cy="9" r="1.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>',
  code: '<path d="m8 8-5 4 5 4"/><path d="m16 8 5 4-5 4"/><path d="m14 4-4 16"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 5V5L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 8a5 5 0 0 1 0 8"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17 4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  cart: '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M3 4h2l2.5 11h11l2-8H6.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.dots}</svg>`;
const CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const MARK_SVG = codenLogoSvg({ size: 28 });

type Overlay = { root: HTMLElement; dialog: HTMLElement; close: () => void };

/** A modal layer: backdrop, focus trap, Escape, scroll lock, focus restored on close. */
function openOverlay(className: string, labelledBy: string, onClose?: () => void, dismissible = true): Overlay {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const root = document.createElement('div');
  root.className = `cuf-overlay ${className}`;
  root.innerHTML = `<div class="cuf-backdrop" data-cuf-backdrop></div><div class="cuf-dialog" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}" tabindex="-1"></div>`;
  document.body.appendChild(root);
  const dialog = root.querySelector<HTMLElement>('.cuf-dialog')!;
  const previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('is-leaving');
    const finish = () => {
      root.remove();
      document.documentElement.style.overflow = previousOverflow;
      previous?.focus?.();
      onClose?.();
    };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) finish();
    else window.setTimeout(finish, 180);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && dismissible) { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select, a[href], input, [tabindex="0"]')).filter(element => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  if (dismissible) root.querySelector('[data-cuf-backdrop]')?.addEventListener('click', close);
  requestAnimationFrame(() => root.classList.add('is-open'));
  return { root, dialog, close };
}

let pricingOpen = false;

/** The Upgrade modal: the paid plans, centred, over the page. */
export function openPricingModal(options: { currentPlan?: string | null; email?: string | null } = {}) {
  if (pricingOpen) return;
  pricingOpen = true;
  let cleanup = () => {};
  const overlay = openOverlay('cuf-pricing', 'cuf-pricing-title', () => { pricingOpen = false; cleanup(); });
  overlay.dialog.innerHTML = `
    <div class="cuf-glow" aria-hidden="true"></div>
    <button type="button" class="cuf-close" data-cuf-close aria-label="Fermer">${CLOSE_SVG}</button>
    <header class="cuf-head">
      <span class="cuf-eyebrow">Passer à la vitesse supérieure</span>
      <h2 id="cuf-pricing-title">Choisissez votre formule</h2>
      <p>Plus de crédits, la publication de vos applications et vos propres domaines. Changez ou arrêtez quand vous voulez.</p>
    </header>
    <div class="cuf-body" data-cuf-plans></div>`;
  overlay.dialog.querySelector('[data-cuf-close]')?.addEventListener('click', overlay.close);
  const host = overlay.dialog.querySelector<HTMLElement>('[data-cuf-plans]')!;
  cleanup = renderPlanChooser(host, {
    source: 'upgrade_modal',
    currentPlan: options.currentPlan,
    email: options.email,
    recommended: 'pro',
    secondary: { label: 'Plus tard', onClick: overlay.close },
  });
  requestAnimationFrame(() => overlay.dialog.querySelector<HTMLElement>('.cpc-plan.is-recommended .cpc-cta')?.focus({ preventScroll: true }));
}

export type OnboardingHandlers = {
  email?: string | null;
  currentPlan?: string | null;
  /** Persists the record (user_metadata); failures are tolerated, the local flag already holds. */
  save: (record: OnboardingRecord) => Promise<void> | void;
};

/** The welcome onboarding. Four taps, then the plans; "Passer" at every step. */
export function openOnboarding(handlers: OnboardingHandlers) {
  const answers: OnboardingAnswers = {};
  const paid = /^(pro|business|enterprise)$/i.test(String(handlers.currentPlan || ''));
  const total = ONBOARDING_STEPS.length + (paid ? 0 : 1);
  let index = 0;
  let saved = false;
  let cleanupPlans = () => {};

  const persist = (record: OnboardingRecord) => {
    if (saved) return;
    saved = true;
    try { void Promise.resolve(handlers.save({ ...record, version: ONBOARDING_VERSION })).catch(() => {}); } catch { /* tolerated */ }
  };
  const overlay = openOverlay('cuf-onboarding', 'cuf-onboarding-title', () => {
    cleanupPlans();
    // Closed with Escape or "Passer" before the end: it does not come back.
    persist({ ...sanitizeAnswers(answers), skipped: true });
  }, true);

  const render = (direction: 1 | -1 = 1) => {
    const onPlans = index >= ONBOARDING_STEPS.length;
    const progress = Array.from({ length: total }, (_, step) => `<span class="${step < index ? 'is-done' : step === index ? 'is-current' : ''}"></span>`).join('');
    const top = `
      <div class="cuf-onb-top">
        <span class="cuf-onb-brand">${MARK_SVG}<span>Bienvenue sur Coden</span></span>
        <div class="cuf-onb-progress" role="progressbar" aria-label="Progression" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${index + 1}">${progress}</div>
        ${onPlans ? '' : '<button type="button" class="cuf-onb-skip" data-cuf-skip>Passer</button>'}
      </div>`;
    if (!onPlans) {
      const step = ONBOARDING_STEPS[index];
      overlay.dialog.innerHTML = `${top}
        <section class="cuf-onb-step" data-direction="${direction}">
          <span class="cuf-onb-count">Étape ${index + 1} sur ${ONBOARDING_STEPS.length}</span>
          <h2 id="cuf-onboarding-title">${step.title}</h2>
          <p>${step.subtitle}</p>
          <div class="cuf-onb-options" role="radiogroup" aria-labelledby="cuf-onboarding-title">
            ${step.options.map(option => `<button type="button" role="radio" class="cuf-onb-option" data-value="${option.value}" aria-checked="${answers[step.key] === option.value}">
              <span class="cuf-onb-icon">${icon(option.icon)}</span>
              <span class="cuf-onb-copy"><strong>${option.label}</strong><small>${option.hint}</small></span>
            </button>`).join('')}
          </div>
          <div class="cuf-onb-nav">
            ${index > 0 ? `<button type="button" class="cuf-onb-back" data-cuf-back>${BACK_SVG}<span>Retour</span></button>` : '<span></span>'}
            <span class="cuf-onb-hint">Un clic suffit</span>
          </div>
        </section>`;
      // Focus the dialog, not the first answer: a ring on "Fondateur" reads as a preselected choice.
      requestAnimationFrame(() => overlay.dialog.focus({ preventScroll: true }));
      return;
    }
    const recommended = recommendPlan(answers);
    overlay.dialog.innerHTML = `${top}
      <section class="cuf-onb-step cuf-onb-plans" data-direction="${direction}">
        <span class="cuf-onb-count">C’est prêt</span>
        <h2 id="cuf-onboarding-title">Choisissez comment continuer</h2>
        <p>D’après vos réponses, <strong>${recommended === 'business' ? 'Business' : 'Pro'}</strong> vous conviendra le mieux. Vous gardez vos 5 crédits offerts dans tous les cas.</p>
        <div data-cuf-plans></div>
        <div class="cuf-onb-nav"><button type="button" class="cuf-onb-back" data-cuf-back>${BACK_SVG}<span>Retour</span></button><span></span></div>
      </section>`;
    cleanupPlans();
    cleanupPlans = renderPlanChooser(overlay.dialog.querySelector<HTMLElement>('[data-cuf-plans]')!, {
      source: 'onboarding',
      recommended,
      currentPlan: handlers.currentPlan,
      email: handlers.email,
      secondary: { label: 'Continuer avec Free', onClick: overlay.close },
    });
    requestAnimationFrame(() => overlay.dialog.querySelector<HTMLElement>('.cpc-plan.is-recommended .cpc-cta')?.focus({ preventScroll: true }));
  };

  const finish = () => persist({ ...sanitizeAnswers(answers), completed_at: new Date().toISOString() });

  overlay.dialog.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-cuf-skip]')) { overlay.close(); return; }
    if (target?.closest('[data-cuf-back]')) { index = Math.max(0, index - 1); render(-1); return; }
    const option = target?.closest<HTMLButtonElement>('.cuf-onb-option');
    if (!option || index >= ONBOARDING_STEPS.length) return;
    const step = ONBOARDING_STEPS[index];
    answers[step.key] = option.dataset.value;
    overlay.dialog.querySelectorAll('.cuf-onb-option').forEach(item => item.setAttribute('aria-checked', String(item === option)));
    // A beat to see the choice land, then the next question.
    window.setTimeout(() => {
      index += 1;
      if (index >= ONBOARDING_STEPS.length) {
        finish();
        if (paid) { overlay.close(); return; }
      }
      render(1);
    }, 180);
  });

  render(1);
}
