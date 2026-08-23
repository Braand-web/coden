import { trackFunnelEvent } from './conversion-events';
import { initThemeController } from './theme-controller';
import { formatUsd, getPublicPlan, type BillingInterval, type PublicPlanKey } from './config/pricing-plans';

export type { BillingInterval, PublicPlanKey } from './config/pricing-plans';

type PricingSelection = {
  plan: PublicPlanKey;
  billing: BillingInterval;
};

function normalizePlan(value: string | null | undefined): PublicPlanKey {
  return value === 'pro' || value === 'scale' ? value : 'free';
}

function normalizeBilling(value: string | null | undefined): BillingInterval {
  return value === 'annual' || value === 'yearly' ? 'annual' : 'monthly';
}

export function readPricingSelection(search = window.location.search): PricingSelection {
  const params = new URLSearchParams(search);
  return {
    plan: normalizePlan(params.get('plan')),
    billing: normalizeBilling(params.get('billing')),
  };
}

export function buildAuthUrl(plan: PublicPlanKey, billing: BillingInterval = 'monthly') {
  return `/auth.html?plan=${encodeURIComponent(plan)}&billing=${encodeURIComponent(billing)}`;
}

export function buildCheckoutUrl(plan: Exclude<PublicPlanKey, 'free'>, billing: BillingInterval = 'monthly') {
  return `/checkout.html?plan=${encodeURIComponent(plan)}&billing=${encodeURIComponent(billing)}`;
}

function updatePricingCopy(selection: PricingSelection) {
  (['pro', 'scale'] as const).forEach((plan) => {
    const pricing = getPublicPlan(plan);
    const price = document.getElementById(`price-${plan}`);
    const note = document.getElementById(`note-${plan}`);

    if (price) {
      price.innerHTML = selection.billing === 'annual'
        ? `${formatUsd(pricing.annual)} <span>/mois</span>`
        : `${formatUsd(pricing.monthly)} <span>/mois</span>`;
    }
    if (note) {
      note.textContent = selection.billing === 'annual'
        ? `Facturé ${formatUsd(pricing.annualTotal)} par an · Économisez ${formatUsd(pricing.annualSaving)}`
        : 'Facturation mensuelle · annulation à tout moment';
    }
  });

  const monthlyButton = document.querySelector<HTMLButtonElement>('[data-billing-toggle="monthly"]');
  const annualButton = document.querySelector<HTMLButtonElement>('[data-billing-toggle="annual"]');
  monthlyButton?.classList.toggle('active', selection.billing === 'monthly');
  annualButton?.classList.toggle('active', selection.billing === 'annual');
  monthlyButton?.setAttribute('aria-pressed', String(selection.billing === 'monthly'));
  annualButton?.setAttribute('aria-pressed', String(selection.billing === 'annual'));
}

function updateCtas(selection: PricingSelection) {
  document.querySelectorAll<HTMLElement>('[data-pricing-plan]').forEach((element) => {
    const plan = normalizePlan(element.dataset.pricingPlan);
    const href = buildAuthUrl(plan, selection.billing);

    if (element instanceof HTMLAnchorElement) element.href = href;
    element.dataset.pricingBilling = selection.billing;
    element.setAttribute('data-funnel-plan', plan);
  });

  const sticky = document.getElementById('pricing-sticky-cta') as HTMLAnchorElement | null;
  const stickyLabel = document.getElementById('pricing-sticky-label');
  if (sticky) {
    const stickyPlan = selection.plan === 'free' ? 'pro' : selection.plan;
    sticky.href = buildAuthUrl(stickyPlan, selection.billing);
    const priceKey = selection.billing === 'annual' ? 'annual' : 'monthly';
    stickyLabel && (stickyLabel.textContent = `${getPublicPlan(stickyPlan).name} · ${formatUsd(getPublicPlan(stickyPlan)[priceKey])}/mois`);
  }
}

export function initPublicPricingFlow() {
  initThemeController();
  const isPricingPage = /\/pricing\.html$/.test(window.location.pathname);
  const pricingLinks = document.querySelectorAll<HTMLElement>('[data-pricing-plan], [data-conversion-plan]');
  if (!isPricingPage && !pricingLinks.length) return;

  let selection = readPricingSelection();
  if (isPricingPage) {
    trackFunnelEvent('pricing_view', { plan: selection.plan, billing: selection.billing });

    document.querySelectorAll<HTMLButtonElement>('[data-billing-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        selection = { ...selection, billing: normalizeBilling(button.dataset.billingToggle) };
        updatePricingCopy(selection);
        updateCtas(selection);
        trackFunnelEvent('billing_interval_changed', selection);
      });
    });

    document.querySelectorAll<HTMLElement>('[data-pricing-plan]').forEach((element) => {
      element.addEventListener('click', () => {
        const plan = normalizePlan(element.dataset.pricingPlan);
        trackFunnelEvent('pricing_plan_click', {
          plan,
          billing: selection.billing,
          text: element.textContent?.trim().replace(/\s+/g, ' '),
        });
      });
    });
  }

  document.querySelectorAll<HTMLElement>('[data-conversion-plan]').forEach((element) => {
    const plan = normalizePlan(element.dataset.conversionPlan);
    if (element instanceof HTMLAnchorElement) element.href = buildAuthUrl(plan, selection.billing);
  });

  updatePricingCopy(selection);
  updateCtas(selection);
}
