/**
 * The paid plans, side by side, with a real checkout.
 *
 * One component for two places: the Upgrade modal opened from the dashboard
 * sidebar, and the last step of the welcome onboarding. Prices come from the
 * same versioned catalogue as the pricing page (config/billing-v2), so the
 * figure shown here is the figure Saspay charges; the checkout itself is the
 * server's, which validates the tier again. In the Upgrade modal, the
 * comparison table of the pricing page follows the cards.
 */
import { apiFetch } from '../lib/api';
import { BILLING_PLANS, FEATURED_PLAN_BADGE, planComparisonRows, planFeatures, priceFor, type BillingInterval } from '../config/billing-v2';
import '../styles/plan-chooser.css';
import { enhanceSelect, type SelectMenu } from '../lib/select-menu';

type PaidPlan = 'pro' | 'business';

export type PlanChooserOptions = {
  recommended?: PaidPlan | null;
  currentPlan?: string | null;
  email?: string | null;
  /** The quiet way out: "Continuer avec Free", "Plus tard"… */
  secondary?: { label: string; onClick: () => void };
  /** Where the choice was made, for the funnel. */
  source: 'upgrade_modal' | 'onboarding';
};

/* The same words as the landing and the pricing page. */
const TAGLINES: Record<PaidPlan, string> = {
  pro: 'Pour itérer vite, connecter votre domaine et garder le contrôle sur vos versions.',
  business: 'Pour les équipes qui ont besoin de rôles, de limites et de capacités avancées.',
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
const formatXaf = (value: number) => new Intl.NumberFormat('fr-FR').format(Math.round(value));

function features(plan: PaidPlan, credits: number): string[] {
  return planFeatures(plan, credits);
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

const COLUMNS = ['free', 'pro', 'business'] as const;

/**
 * Every plan, capacity by capacity: the pricing page's table, row for row
 * (both come from planComparisonRows). The recommended plan's column carries
 * the accent; the plan someone already has is marked in its header.
 */
function comparisonTable(recommended: PaidPlan, current: string): string {
  const head = COLUMNS.map(plan => {
    const mark = plan === current ? '<small>Votre forfait</small>' : '';
    return `<th scope="col"${plan === recommended ? ' class="is-featured"' : ''}><span>${BILLING_PLANS[plan].name}</span>${mark}</th>`;
  }).join('');
  const body = planComparisonRows().map(row => `
          <tr><th scope="row">${escapeHtml(row.label)}</th>${COLUMNS.map(plan => `<td${plan === recommended ? ' class="is-featured"' : ''}>${escapeHtml(row[plan])}</td>`).join('')}</tr>`).join('');
  return `
      <section class="cpc-compare" aria-labelledby="cpc-compare-title">
        <h3 id="cpc-compare-title">Comparer les forfaits</h3>
        <div class="cpc-compare-scroll" tabindex="0" role="region" aria-labelledby="cpc-compare-title">
          <table>
            <thead><tr><th scope="col">Capacité</th>${head}</tr></thead>
            <tbody>${body}
            </tbody>
          </table>
        </div>
      </section>`;
}

export function renderPlanChooser(host: HTMLElement, options: PlanChooserOptions): () => void {
  let interval: BillingInterval = 'monthly';
  const tiers: Record<PaidPlan, number> = { pro: BILLING_PLANS.pro.tiers[0], business: BILLING_PLANS.business.tiers[0] };
  const recommended = options.recommended || 'pro';
  const current = String(options.currentPlan || '').toLowerCase();

  const card = (plan: PaidPlan) => {
    const name = BILLING_PLANS[plan].name;
    const isCurrent = current === plan;
    return `
      <article class="cpc-plan${plan === recommended ? ' is-recommended' : ''}" data-plan="${plan}">
        ${plan === recommended ? `<span class="cpc-badge">${options.source === 'onboarding' ? 'Recommandé pour vous' : FEATURED_PLAN_BADGE}</span>` : ''}
        <header>
          <h3>${name}</h3>
          <p>${TAGLINES[plan]}</p>
        </header>
        <div class="cpc-price" aria-live="polite"><strong data-cpc-amount></strong><span>FCFA / mois</span></div>
        <small class="cpc-billed" data-cpc-billed></small>
        <label class="cpc-tier">
          <span>Crédits par mois</span>
          <select data-cpc-tier aria-label="Crédits par mois, ${name}">
            ${BILLING_PLANS[plan].tiers.map(tier => `<option value="${tier}"${tier === tiers[plan] ? ' selected' : ''}>${formatXaf(tier)} crédits</option>`).join('')}
          </select>
        </label>
        <button type="button" class="cpc-cta${plan === recommended ? ' is-primary' : ''}" data-cpc-checkout ${isCurrent ? 'disabled' : ''}>${isCurrent ? 'Votre forfait actuel' : `S’abonner à ${name}`}</button>
        <ul class="cpc-features" data-cpc-features></ul>
      </article>`;
  };

  host.innerHTML = `
    <div class="cpc">
      <div class="cpc-toggle" role="group" aria-label="Fréquence de paiement">
        <button type="button" data-cpc-interval="monthly" aria-pressed="true">Mensuel</button>
        <button type="button" data-cpc-interval="annual" aria-pressed="false">Annuel <em>−20 %</em></button>
      </div>
      <div class="cpc-grid">${card('pro')}${card('business')}</div>
      <p class="cpc-error" role="alert" hidden></p>${options.source === 'upgrade_modal' ? comparisonTable(recommended, current) : ''}
      <div class="cpc-foot">
        ${options.secondary ? `<button type="button" class="cpc-secondary" data-cpc-secondary>${escapeHtml(options.secondary.label)}</button>` : ''}
        <p>Paiement sécurisé en FCFA via Saspay · sans engagement, résiliable à tout moment.</p>
      </div>
    </div>`;

  const update = () => {
    (['pro', 'business'] as PaidPlan[]).forEach(plan => {
      const article = host.querySelector<HTMLElement>(`.cpc-plan[data-plan="${plan}"]`);
      if (!article) return;
      const price = priceFor(plan, tiers[plan], interval);
      const amount = article.querySelector<HTMLElement>('[data-cpc-amount]');
      const billed = article.querySelector<HTMLElement>('[data-cpc-billed]');
      const list = article.querySelector<HTMLElement>('[data-cpc-features]');
      if (amount) amount.textContent = formatXaf(price.monthlyEquivalent);
      if (billed) billed.textContent = interval === 'annual' ? `${formatXaf(price.amount)} FCFA facturés une fois par an` : 'Facturé chaque mois';
      if (list) list.innerHTML = features(plan, tiers[plan]).map(item => `<li>${CHECK_SVG}<span>${escapeHtml(item)}</span></li>`).join('');
    });
    host.querySelectorAll<HTMLButtonElement>('[data-cpc-interval]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.cpcInterval === interval));
    });
    menus?.forEach(menu => menu.refresh());
  };

  const showError = (message: string) => {
    const box = host.querySelector<HTMLElement>('.cpc-error');
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
  };

  const checkout = async (plan: PaidPlan, button: HTMLButtonElement) => {
    const label = button.textContent || '';
    button.disabled = true;
    button.textContent = 'Ouverture du paiement…';
    showError('');
    try {
      const response = await apiFetch<{ success: boolean; url?: string }>('/api/billing/checkout/subscription', {
        method: 'POST',
        body: JSON.stringify({
          planKey: plan,
          credits: tiers[plan],
          billingInterval: interval,
          email: options.email || undefined,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response?.url) throw new Error('Saspay n’a pas renvoyé de page de paiement. Réessayez dans un instant.');
      window.location.assign(response.url);
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      showError(error instanceof Error && error.message ? error.message : 'Le paiement est momentanément indisponible.');
    }
  };

  const onClick = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    const intervalButton = target?.closest<HTMLButtonElement>('[data-cpc-interval]');
    if (intervalButton) {
      interval = intervalButton.dataset.cpcInterval === 'annual' ? 'annual' : 'monthly';
      update();
      return;
    }
    const checkoutButton = target?.closest<HTMLButtonElement>('[data-cpc-checkout]');
    if (checkoutButton && !checkoutButton.disabled) {
      const plan = checkoutButton.closest<HTMLElement>('[data-plan]')?.dataset.plan === 'business' ? 'business' : 'pro';
      void checkout(plan, checkoutButton);
      return;
    }
    if (target?.closest('[data-cpc-secondary]')) options.secondary?.onClick();
  };
  const onChange = (event: Event) => {
    const select = event.target instanceof HTMLSelectElement && event.target.matches('[data-cpc-tier]') ? event.target : null;
    if (!select) return;
    const plan = select.closest<HTMLElement>('[data-plan]')?.dataset.plan === 'business' ? 'business' : 'pro';
    const value = Number(select.value);
    if (BILLING_PLANS[plan].tiers.includes(value)) tiers[plan] = value;
    update();
  };

  /* The same tier menu as the pricing page and the landing, each tier with its price. */
  const menus: SelectMenu[] = Array.from(host.querySelectorAll<HTMLSelectElement>('[data-cpc-tier]')).map(select => {
    const plan: PaidPlan = select.closest<HTMLElement>('[data-plan]')?.dataset.plan === 'business' ? 'business' : 'pro';
    return enhanceSelect(select, { describe: value => `${formatXaf(priceFor(plan, Number(value), interval).monthlyEquivalent)} FCFA / mois` });
  });

  host.addEventListener('click', onClick);
  host.addEventListener('change', onChange);
  update();
  return () => {
    menus.forEach(menu => menu.close());
    host.removeEventListener('click', onClick);
    host.removeEventListener('change', onChange);
  };
}
