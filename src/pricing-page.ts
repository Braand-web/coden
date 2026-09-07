import './main';
import './pricing-page.css';

type BillingInterval = 'monthly' | 'annual';
type PricingPlan = {
  key: 'free' | 'pro' | 'business';
  capabilities?: string[];
};
type PublicPrice = {
  plan: 'pro' | 'business';
  credits: number;
  interval: BillingInterval;
  amountUsd: number;
  monthlyEquivalentUsd: number;
};
type BillingCatalogResponse = {
  success?: boolean;
  catalog?: { annualDiscountPercent?: number; plans?: PricingPlan[]; prices?: PublicPrice[] };
};

const intervals = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-pricing-interval]'));
const tiers = Array.from(document.querySelectorAll<HTMLSelectElement>('[data-pricing-tier]'));
const status = document.getElementById('pricing-data-status');
let selectedInterval: BillingInterval = 'monthly';
let prices: PublicPrice[] = [];

function usd(value: number) {
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}`;
}

function fallbackPrice(plan: 'pro' | 'business', credits: number, interval: BillingInterval): PublicPrice {
  const monthly = (plan === 'pro' ? 0.25 : 0.5) * credits;
  const amount = interval === 'annual' ? monthly * 12 * 0.8 : monthly;
  return {
    plan,
    credits,
    interval,
    amountUsd: Number(amount.toFixed(2)),
    monthlyEquivalentUsd: Number((interval === 'annual' ? amount / 12 : amount).toFixed(2)),
  };
}

function priceFor(plan: 'pro' | 'business', credits: number) {
  return prices.find(price => price.plan === plan && price.credits === credits && price.interval === selectedInterval)
    || fallbackPrice(plan, credits, selectedInterval);
}

function planRedirect(plan: 'free' | 'pro' | 'business', credits?: number) {
  const query = new URLSearchParams({ settings: 'facturation', plan, interval: selectedInterval });
  if (credits) query.set('credits', String(credits));
  return `/auth.html?mode=signup&redirect=${encodeURIComponent(`/dashboard.html?${query.toString()}`)}`;
}

function updateCard(plan: 'pro' | 'business') {
  const select = document.querySelector<HTMLSelectElement>(`[data-pricing-tier="${plan}"]`);
  const credits = Number(select?.value || 100);
  const price = priceFor(plan, credits);
  const priceNode = document.querySelector<HTMLElement>(`[data-pricing-price="${plan}"]`);
  const unitNode = document.querySelector<HTMLElement>(`[data-pricing-price-unit="${plan}"]`);
  const noteNode = document.querySelector<HTMLElement>(`[data-pricing-price-note="${plan}"]`);
  const cta = document.querySelector<HTMLAnchorElement>(`[data-plan-cta="${plan}"]`);
  if (priceNode) priceNode.textContent = usd(price.monthlyEquivalentUsd);
  if (unitNode) unitNode.textContent = selectedInterval === 'annual' ? 'par mois' : 'par mois';
  if (noteNode) {
    noteNode.textContent = selectedInterval === 'annual'
      ? `Facturé ${usd(price.amountUsd)} par an`
      : 'Facturé mensuellement';
  }
  if (cta) cta.href = planRedirect(plan, credits);
}

function updateAllCards() {
  updateCard('pro');
  updateCard('business');
  const freeCta = document.querySelector<HTMLAnchorElement>('[data-plan-cta="free"]');
  if (freeCta) freeCta.href = planRedirect('free');
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

function renderCapabilities(plan: PricingPlan) {
  const list = document.querySelector<HTMLUListElement>(`[data-pricing-capabilities="${plan.key}"]`);
  if (!list || !plan.capabilities?.length) return;
  const existingGrantItems = Array.from(list.querySelectorAll('li')).slice(0, 2).map(item => item.textContent || '');
  const values = [...existingGrantItems, ...plan.capabilities.slice(0, 3)];
  list.replaceChildren(...values.map(value => {
    const item = document.createElement('li');
    item.textContent = value;
    return item;
  }));
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
    (data.catalog.plans || []).forEach(renderCapabilities);
    const discount = Number(data.catalog.annualDiscountPercent || 20);
    const annualButton = document.querySelector<HTMLButtonElement>('[data-pricing-interval="annual"] strong');
    if (annualButton && Number.isFinite(discount)) annualButton.textContent = `−${discount} %`;
    if (status) status.textContent = 'Tarifs synchronisés avec le catalogue Coden.';
    updateAllCards();
  })
  .catch(() => {
    if (status) status.textContent = 'Catalogue temporairement indisponible. Le montant sera confirmé avant paiement.';
  });

updateAllCards();
