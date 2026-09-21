import './main';
import './pricing-page.css';
import { ANNUAL_DISCOUNT, priceFor as catalogPriceFor, type BillingInterval } from './config/billing-v2';

type PricingPlan = {
  key: 'free' | 'pro' | 'business';
  baseCredits?: number;
  tiers?: number[];
  capabilities?: string[];
};
type PublicPrice = {
  plan: 'pro' | 'business';
  credits: number;
  interval: BillingInterval;
  amount: number;
  monthlyEquivalent: number;
  currency: 'XAF';
};
type BillingCatalogResponse = {
  success?: boolean;
  catalog?: { currency?: string; annualDiscountPercent?: number; plans?: PricingPlan[]; prices?: PublicPrice[] };
};

const intervals = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-pricing-interval]'));
const tiers = Array.from(document.querySelectorAll<HTMLSelectElement>('[data-pricing-tier]'));
const status = document.getElementById('pricing-data-status');
let selectedInterval: BillingInterval = 'monthly';
let prices: PublicPrice[] = [];
const plans = new Map<PricingPlan['key'], PricingPlan>();
let signedIn = false;
let currentPlan: string | null = null;

function money(value: number, currency = 'XAF') {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/*
 * The same computation the server bills from, not a copy of its numbers.
 *
 * This used to multiply credits by a rate written here — 150 for Pro, 300 for
 * Business — which happened to match the catalogue and had no way of staying
 * that way. A price shown on this page and a price charged at checkout that
 * disagree is the one bug a pricing page must not have, so the fallback now
 * runs `priceFor` from the billing configuration: the network may be down, the
 * arithmetic is still the real one.
 */
function fallbackPrice(plan: 'pro' | 'business', credits: number, interval: BillingInterval): PublicPrice {
  const price = catalogPriceFor(plan, credits, interval);
  return {
    plan,
    credits,
    interval,
    amount: price.amount,
    monthlyEquivalent: price.monthlyEquivalent,
    currency: price.currency,
  };
}

function priceFor(plan: 'pro' | 'business', credits: number) {
  return prices.find(price => price.plan === plan && price.credits === credits && price.interval === selectedInterval)
    || fallbackPrice(plan, credits, selectedInterval);
}

/**
 * Where choosing a plan takes you, which depends on who you are.
 *
 * Signed out, the choice has to survive the detour through authentication, so
 * it travels in the redirect and is waiting on the other side.
 *
 * Signed in, there is no detour to make: sending someone who already has an
 * account to a signup page — which is what this did for everyone — is asking
 * them to prove again something the page already knows.
 */
function planRedirect(plan: 'free' | 'pro' | 'business', credits?: number) {
  const query = new URLSearchParams({ settings: 'facturation', plan, interval: selectedInterval });
  if (credits) query.set('credits', String(credits));
  const destination = `/dashboard.html?${query.toString()}`;
  return signedIn ? destination : `/auth.html?mode=signup&redirect=${encodeURIComponent(destination)}`;
}

/**
 * Saying which plan is already theirs, and not selling it twice.
 *
 * Someone on Pro looking at the Pro card is not a buyer: the useful thing to
 * tell them is that they already have it, and the useful button is the one
 * that manages it rather than one that starts a second checkout.
 */
function markCurrentPlan() {
  for (const key of ['free', 'pro', 'business'] as const) {
    const card = document.querySelector<HTMLElement>(`[data-pricing-plan="${key}"]`);
    const cta = document.querySelector<HTMLAnchorElement>(`[data-plan-cta="${key}"]`);
    const isCurrent = signedIn && currentPlan === key;
    card?.classList.toggle('is-current-plan', isCurrent);
    if (isCurrent) {
      card?.setAttribute('data-current-plan-label', 'Plan actuel');
      if (cta) {
        cta.textContent = 'Gérer mon abonnement';
        cta.href = '/dashboard.html?settings=facturation';
      }
    } else {
      card?.removeAttribute('data-current-plan-label');
    }
  }
}

function updateCard(plan: 'pro' | 'business') {
  const select = document.querySelector<HTMLSelectElement>(`[data-pricing-tier="${plan}"]`);
  const credits = Number(select?.value || (plan === 'pro' ? 25 : 250));
  const price = priceFor(plan, credits);
  const priceNode = document.querySelector<HTMLElement>(`[data-pricing-price="${plan}"]`);
  const unitNode = document.querySelector<HTMLElement>(`[data-pricing-price-unit="${plan}"]`);
  const noteNode = document.querySelector<HTMLElement>(`[data-pricing-price-note="${plan}"]`);
  const cta = document.querySelector<HTMLAnchorElement>(`[data-plan-cta="${plan}"]`);
  if (priceNode) priceNode.textContent = money(price.monthlyEquivalent, price.currency);
  if (unitNode) unitNode.textContent = selectedInterval === 'annual' ? 'par mois' : 'par mois';
  if (noteNode) {
    noteNode.textContent = selectedInterval === 'annual'
      ? `Paiement annuel de ${money(price.amount, price.currency)}`
      : 'Facturé mensuellement';
  }
  if (cta) cta.href = planRedirect(plan, credits);
  renderCapabilities(plans.get(plan) || { key: plan }, credits);
}

function updateAllCards() {
  updateCard('pro');
  updateCard('business');
  const freeCta = document.querySelector<HTMLAnchorElement>('[data-plan-cta="free"]');
  if (freeCta) freeCta.href = planRedirect('free');
  markCurrentPlan();
}

function setInterval(next: BillingInterval) {
  selectedInterval = next;
  intervals.forEach(button => {
    const active = button.dataset.pricingInterval === next;
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateAllCards();
}

function renderCapabilities(plan: PricingPlan, selectedCredits = Number(plan.baseCredits || 0)) {
  const list = document.querySelector<HTMLUListElement>(`[data-pricing-capabilities="${plan.key}"]`);
  if (!list) return;
  let values = [...(plan.capabilities || [])];
  if (plan.key === 'pro') {
    const sites = selectedCredits >= 100 ? 'Sites publiés illimités' : `${selectedCredits >= 60 ? 3 : 1} site${selectedCredits >= 60 ? 's' : ''} publié${selectedCredits >= 60 ? 's' : ''}`;
    const domains = selectedCredits >= 100 ? 10 : selectedCredits >= 60 ? 3 : 1;
    values = [
      `${selectedCredits} crédits chaque mois`,
      sites,
      `${domains} domaine${domains > 1 ? 's' : ''} personnalisé${domains > 1 ? 's' : ''}`,
      'Édition et export du code',
      'Historique des versions et rollback',
    ];
  } else if (plan.key === 'business') {
    values = [
      `${selectedCredits || 250} crédits chaque mois`,
      'Sites publiés illimités',
      'Domaines personnalisés illimités',
      'Rôles et projets internes',
      'Modèles premium et support prioritaire',
    ];
  }
  if (!values.length) return;
  list.replaceChildren(...values.map(value => {
    const item = document.createElement('li');
    item.textContent = value;
    return item;
  }));
}

function syncTierOptions(plan: 'pro' | 'business', definition?: PricingPlan) {
  const select = document.querySelector<HTMLSelectElement>(`[data-pricing-tier="${plan}"]`);
  if (!select) return;
  const fromCatalog = (definition?.tiers || []).map(Number).filter(value => Number.isFinite(value) && value > 0);
  const fromPrices = prices.filter(price => price.plan === plan && price.interval === 'monthly').map(price => Number(price.credits));
  const fallback = plan === 'pro' ? [25, 60, 100] : [250];
  const values = [...new Set((fromCatalog.length ? fromCatalog : fromPrices.length ? fromPrices : fallback))].sort((a, b) => a - b);
  const previous = Number(select.value);
  select.replaceChildren(...values.map(value => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${new Intl.NumberFormat('fr-FR').format(value)} crédits`;
    return option;
  }));
  const preferred = values.includes(previous) ? previous : Number(definition?.baseCredits || values[0]);
  select.value = String(values.includes(preferred) ? preferred : values[0]);
}

intervals.forEach(button => button.addEventListener('click', () => {
  setInterval(button.dataset.pricingInterval === 'annual' ? 'annual' : 'monthly');
}));

tiers.forEach(select => select.addEventListener('change', () => {
  const plan = select.dataset.pricingTier;
  if (plan === 'pro' || plan === 'business') updateCard(plan);
}));

void fetch('/api/billing/plans', { headers: { Accept: 'application/json' } })
  .then(async response => {
    if (!response.ok) throw new Error(`catalog ${response.status}`);
    return response.json() as Promise<BillingCatalogResponse>;
  })
  .then(data => {
    if (!data.catalog) throw new Error('missing catalog');
    prices = Array.isArray(data.catalog.prices) ? data.catalog.prices : [];
    (data.catalog.plans || []).forEach(plan => plans.set(plan.key, plan));
    syncTierOptions('pro', plans.get('pro'));
    syncTierOptions('business', plans.get('business'));
    const freePlan = plans.get('free');
    if (freePlan) renderCapabilities(freePlan, Number(freePlan.baseCredits || 5));
    const discount = Number(data.catalog.annualDiscountPercent || Math.round(ANNUAL_DISCOUNT * 100));
    const annualButton = document.querySelector<HTMLButtonElement>('[data-pricing-interval="annual"] strong');
    if (annualButton && Number.isFinite(discount)) annualButton.textContent = `−${discount} %`;
    if (status) status.textContent = 'Tarifs synchronisés avec le catalogue Coden.';
    updateAllCards();
  })
  .catch(() => {
    if (status) status.textContent = 'Catalogue temporairement indisponible. Le montant sera confirmé avant paiement.';
  });

updateAllCards();

/*
 * Who is reading this, asked once.
 *
 * The wallet is the only endpoint that knows both whether there is a session
 * and which plan it is on. It needs credentials and answers 401 to a visitor,
 * which is the answer rather than a failure — a pricing page must render
 * completely for someone who has never signed in, so this only ever upgrades
 * what is already on screen.
 */
void fetch('/api/billing/wallet', { headers: { Accept: 'application/json' }, credentials: 'include' })
  .then(response => (response.ok ? response.json() : null))
  .then((data: { plan?: { key?: string } | null; planKey?: string } | null) => {
    if (!data) return;
    signedIn = true;
    currentPlan = String(data.plan?.key || data.planKey || '') || null;
    updateAllCards();
  })
  .catch(() => {
    // A visitor, or an offline wallet. Either way the page stays as it is.
  });
