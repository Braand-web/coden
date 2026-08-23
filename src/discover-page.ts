// @ts-ignore
import './index.css';
import { initLandingI18n } from './landing-i18n';
import { initThemeController } from './theme-controller';

type ShowcaseCard = {
  id: string;
  title: string;
  slug: string | null;
  category: string;
  updated_at?: string | null;
};

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function thumbClass(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('commerce')) return 'dt-commerce';
  if (c.includes('saas')) return 'dt-saas';
  if (c.includes('book')) return 'dt-booking';
  if (c.includes('restaurant')) return 'dt-restaurant';
  if (c.includes('edu') || c.includes('class') || c.includes('learn')) return 'dt-learning';
  if (c.includes('task') || c.includes('productiv')) return 'dt-task';
  if (c.includes('commerce')) return 'dt-commerce';
  return 'dt-saas';
}

// Progressive enhancement: fetch the public, consent-gated showcase feed and, only
// if real published free-plan projects come back, reveal a "Community" section.
// Otherwise the honest starter templates already in the page remain the content.
async function loadCommunityShowcase(): Promise<void> {
  const section = document.getElementById('community-section');
  const grid = document.getElementById('community-grid');
  if (!section || !grid) return;
  try {
    const res = await fetch('/api/discover?limit=8', { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    const projects: ShowcaseCard[] = Array.isArray(data?.projects) ? data.projects : [];
    if (!projects.length) return;

    grid.innerHTML = projects
      .map(
        (p) => `
        <article class="discover-card reveal active">
          <span class="discover-thumb ${thumbClass(p.category)}" aria-hidden="true"><span class="discover-thumb-mark">${escapeHtml(
          (p.title || 'H').slice(0, 1).toUpperCase(),
        )}</span></span>
          <span class="discover-category">${escapeHtml(p.category)}</span>
          <h3>${escapeHtml(p.title || 'Untitled')}</h3>
          <p>Built and published with Coden</p>
        </article>`,
      )
      .join('');
    section.hidden = false;
  } catch {
    /* Network/endpoint unavailable — keep the curated templates only. */
  }
}

function init(): void {
  initThemeController();
  initLandingI18n();
  // This page is static gallery content; reveal everything immediately.
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('active'));
  void loadCommunityShowcase();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
