import './checkout.css';
import './styles/coden-shell.css';
import { initThemeController } from './theme-controller';
import { getAuthRedirectUrl, getVerifiedSession } from './lib/supabase-browser';
import { buildAuthUrl, readPricingSelection, type BillingInterval, type PublicPlanKey } from './public-pricing-flow';
import { trackFunnelEvent } from './conversion-events';
import { initCodenMotion } from './coden-motion';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { formatUsd, getPublicPlan, type PublicPlanDetails } from './config/pricing-plans';
import './styles/modern-shell.css';
import './styles/coherence.css';

initCodenMotion();
initCodenNavigationTransitions();
initThemeController();

let selection = readPricingSelection();
const detailsFor = (plan: PublicPlanKey): PublicPlanDetails => getPublicPlan(plan === 'scale' ? 'scale' : 'pro');

function checkoutUrl() {
  const current = new URL(window.location.href);
  current.searchParams.set('plan', selection.plan);
  current.searchParams.set('billing', selection.billing);
  return current.toString();
}

function render() {
  const details = detailsFor(selection.plan);
  const amount = selection.billing === 'annual' ? details.annual : details.monthly;
  document.querySelectorAll<HTMLElement>('[data-checkout-plan-name]').forEach((element) => { element.textContent = details.name; });
  const price = document.getElementById('checkout-price');
  const interval = document.getElementById('checkout-interval');
  const annualNote = document.getElementById('checkout-annual-note');
  if (price) price.textContent = formatUsd(amount);
  if (interval) interval.textContent = selection.billing === 'annual' ? '/mois · facturé annuellement' : '/mois';
  if (annualNote) annualNote.textContent = selection.billing === 'annual' ? `Facturé ${formatUsd(details.annualTotal)} par an · économisez ${formatUsd(details.annualSaving)}` : 'Facturation mensuelle · annulation à tout moment';
  const bestFor = document.getElementById('checkout-best-for');
  const credits = document.getElementById('checkout-credits');
  const cloud = document.getElementById('checkout-cloud');
  if (bestFor) bestFor.textContent = details.bestFor;
  if (credits) credits.textContent = details.credits;
  if (cloud) cloud.textContent = details.cloud;
  document.querySelectorAll<HTMLButtonElement>('[data-checkout-billing]').forEach((button) => {
    const active = button.dataset.checkoutBilling === selection.billing;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const changePlan = document.getElementById('checkout-change-plan') as HTMLAnchorElement | null;
  if (changePlan) changePlan.href = `/pricing.html?plan=${selection.plan}&billing=${selection.billing}`;
  const summaryBilling = document.getElementById('checkout-summary-billing');
  const summaryTotal = document.getElementById('checkout-summary-total');
  if (summaryBilling) summaryBilling.textContent = selection.billing === 'annual' ? 'Annuelle' : 'Mensuelle';
  if (summaryTotal) summaryTotal.textContent = formatUsd(selection.billing === 'annual' ? details.annualTotal : details.monthly);
  window.history.replaceState({}, '', checkoutUrl());
}

async function startCheckout() {
  const button = document.getElementById('checkout-submit') as HTMLButtonElement | null;
  const status = document.getElementById('checkout-status');
  const session = await getVerifiedSession({ allowRefresh: true });
  if (!session?.session?.access_token) {
    window.location.href = buildAuthUrl(selection.plan, selection.billing);
    return;
  }
  if (!button || !status) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Ouverture du paiement…';
  status.textContent = 'Connexion sécurisée à Stripe…';
  trackFunnelEvent('checkout_started', selection);
  try {
    const response = await fetch('/api/billing/checkout/subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session.access_token}` },
      body: JSON.stringify({
        planKey: selection.plan,
        billingInterval: selection.billing,
        successUrl: `${window.location.origin}/checkout.html?plan=${selection.plan}&billing=${selection.billing}&success=true`,
        cancelUrl: `${window.location.origin}/checkout.html?plan=${selection.plan}&billing=${selection.billing}&cancel=true`,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.url) throw new Error(payload.error || 'Le paiement est temporairement indisponible.');
    trackFunnelEvent('checkout_redirected', selection);
    window.location.href = payload.url;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Le paiement est temporairement indisponible.';
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = 'Continuer vers le paiement';
  }
}

function renderResultState() {
  const params = new URLSearchParams(window.location.search);
  const result = document.getElementById('checkout-result');
  if (!result) return;
  if (params.get('success') === 'true') {
    result.hidden = false;
    result.dataset.tone = 'success';
    result.textContent = 'Paiement reçu. Votre espace sera activé dès confirmation de Stripe.';
    trackFunnelEvent('checkout_completed', selection);
  } else if (params.get('cancel') === 'true') {
    result.hidden = false;
    result.dataset.tone = 'info';
    result.textContent = 'Paiement annulé. Votre choix est conservé, vous pouvez reprendre quand vous voulez.';
  }
}

async function init() {
  selection = readPricingSelection();
  if (selection.plan === 'free') selection = { plan: 'pro', billing: selection.billing };
  trackFunnelEvent('checkout_viewed', selection);
  render();
  renderResultState();
  document.querySelectorAll<HTMLButtonElement>('[data-checkout-billing]').forEach((button) => {
    button.addEventListener('click', () => {
      selection = { ...selection, billing: button.dataset.checkoutBilling as BillingInterval };
      render();
      trackFunnelEvent('billing_interval_changed', selection);
    });
  });
  document.getElementById('checkout-submit')?.addEventListener('click', () => void startCheckout());
  const session = await getVerifiedSession({ allowRefresh: true });
  if (!session?.session?.access_token) {
    const signIn = document.getElementById('checkout-sign-in') as HTMLAnchorElement | null;
    if (signIn) signIn.href = getAuthRedirectUrl(window.location.pathname + window.location.search);
  }
}

void init();
