/**
 * Integrations, through Composio.
 *
 * One grid, used in Settings → Intégrations and in the Builder's modal: the
 * catalogue comes from Composio (via Coden's server — the API key never
 * reaches the browser), each card shows whether this account is connected,
 * and Connecter opens Composio's hosted connect page in a popup. When the
 * popup reports back (or is closed), the connections are read again and the
 * card changes state.
 *
 * `connectToolkit()` and `openIntegrationsModal()` are also what the chat's
 * connection question uses, so a service picked there is connected by exactly
 * the same flow.
 */
import { apiFetch } from './lib/api';

export type IntegrationToolkit = {
  slug: string;
  name: string;
  description: string;
  logo: string;
  categories: Array<{ id: string; name: string }>;
  toolsCount: number;
  noAuth: boolean;
  managed: boolean;
};

type Connection = { id: string; toolkit: string; status: string };
export type ConnectResult = 'connected' | 'cancelled' | 'failed' | 'unavailable';

const ACTIVE = 'ACTIVE';
const PENDING = new Set(['INITIATED', 'INITIALIZING']);

// ─── API ────────────────────────────────────────────────────────────────────

let configuredPromise: Promise<boolean> | null = null;
export function integrationsConfigured(): Promise<boolean> {
  configuredPromise ||= apiFetch<{ configured?: boolean }>('/api/integrations/status')
    .then(payload => payload.configured === true)
    .catch(() => { configuredPromise = null; return false; });
  return configuredPromise;
}

async function fetchConnections(): Promise<Connection[]> {
  const payload = await apiFetch<{ connections?: Connection[] }>('/api/integrations/connections');
  return Array.isArray(payload.connections) ? payload.connections : [];
}

async function fetchCategories(): Promise<Array<{ id: string; name: string }>> {
  const payload = await apiFetch<{ categories?: Array<{ id: string; name: string }> }>('/api/integrations/categories');
  return Array.isArray(payload.categories) ? payload.categories : [];
}

async function fetchToolkits(query: { search: string; category: string; cursor?: string | null }) {
  const params = new URLSearchParams({ limit: '30' });
  if (query.search) params.set('search', query.search);
  if (query.category) params.set('category', query.category);
  if (query.cursor) params.set('cursor', query.cursor);
  const payload = await apiFetch<{ items?: IntegrationToolkit[]; nextCursor?: string | null }>(`/api/integrations/toolkits?${params}`);
  return { items: Array.isArray(payload.items) ? payload.items : [], nextCursor: payload.nextCursor || null };
}

// ─── Connect flow ───────────────────────────────────────────────────────────

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function activeFor(slug: string): Promise<{ active: boolean; pending: boolean }> {
  const connections = (await fetchConnections().catch(() => [])).filter(item => item.toolkit === slug);
  return { active: connections.some(item => item.status === ACTIVE), pending: connections.some(item => PENDING.has(item.status)) };
}

let connectInFlight: Promise<ConnectResult> | null = null;

/**
 * Connects one toolkit for the signed-in account: a popup on Composio's
 * hosted page, a status sheet over the app while it is open, and a fresh read
 * of the connections once it closes. Must be called from a click, so the
 * popup is opened before any network wait and is not blocked.
 */
export function connectToolkit(slug: string, label = slug): Promise<ConnectResult> {
  if (connectInFlight) return connectInFlight;
  const popup = window.open('', 'coden-integration', 'popup=yes,width=520,height=720');
  connectInFlight = runConnect(slug, label, popup).finally(() => { connectInFlight = null; });
  return connectInFlight;
}

async function runConnect(slug: string, label: string, popup: Window | null): Promise<ConnectResult> {
  const sheet = showConnectSheet(label);
  try {
    if (popup) {
      try {
        popup.document.title = `Connexion à ${label} · Coden`;
        popup.document.body.innerHTML = '<p style="font:15px system-ui,sans-serif;padding:32px">Ouverture de la page de connexion…</p>';
      } catch { /* cross-origin already: nothing to draw */ }
    }
    let redirectUrl = '';
    try {
      const payload = await apiFetch<{ redirectUrl?: string }>('/api/integrations/connect', { method: 'POST', body: JSON.stringify({ toolkit: slug }) });
      redirectUrl = String(payload.redirectUrl || '');
    } catch (error) {
      popup?.close();
      sheet.fail(error instanceof Error ? error.message : 'La connexion n’a pas pu démarrer.');
      return /configur/i.test(String((error as Error)?.message || '')) ? 'unavailable' : 'failed';
    }
    if (!/^https:\/\//.test(redirectUrl)) {
      popup?.close();
      sheet.fail('Composio n’a pas renvoyé de page de connexion.');
      return 'failed';
    }
    let target = popup;
    if (target && !target.closed) {
      target.location.href = redirectUrl;
    } else {
      // Popup blocked: the sheet offers the page as a link the person opens.
      sheet.offerLink(redirectUrl);
      target = null;
    }

    const outcome = await new Promise<'callback' | 'closed' | 'cancelled' | 'failed'>(resolve => {
      let settled = false;
      const finish = (value: 'callback' | 'closed' | 'cancelled' | 'failed') => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        window.clearInterval(poll);
        window.clearTimeout(timeout);
        resolve(value);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data as { type?: string; toolkit?: string; status?: string } | null;
        if (data?.type !== 'coden:integration-callback' || (data.toolkit && data.toolkit !== slug)) return;
        finish(data.status === 'failed' ? 'failed' : 'callback');
      };
      window.addEventListener('message', onMessage);
      const poll = window.setInterval(async () => {
        if (target && target.closed) finish('closed');
        if (!target) {
          // No window to watch: the connection itself says when it is done.
          const state = await activeFor(slug);
          if (state.active) finish('callback');
        }
      }, 800);
      const timeout = window.setTimeout(() => finish('closed'), 10 * 60_000);
      sheet.onCancel(() => { target?.close(); finish('cancelled'); });
    });

    if (outcome === 'cancelled') { sheet.close(); return 'cancelled'; }
    sheet.checking();
    // Composio may take a moment to mark a fresh connection ACTIVE.
    for (let attempt = 0; attempt < (outcome === 'callback' ? 8 : 3); attempt += 1) {
      const state = await activeFor(slug);
      if (state.active) {
        sheet.done(label);
        await wait(700);
        sheet.close();
        document.dispatchEvent(new CustomEvent('coden:integrations-changed', { detail: { toolkit: slug, connected: true } }));
        return 'connected';
      }
      if (!state.pending && outcome !== 'callback') break;
      await wait(1200);
    }
    if (outcome === 'failed') {
      sheet.fail(`La connexion à ${label} n’a pas abouti.`);
      return 'failed';
    }
    sheet.close();
    return 'cancelled';
  } catch {
    sheet.fail('La connexion a été interrompue.');
    return 'failed';
  }
}

function showConnectSheet(label: string) {
  installStyles();
  const overlay = document.createElement('div');
  overlay.className = 'coden-int-sheet-overlay';
  overlay.innerHTML = `
    <div class="coden-int-sheet" role="dialog" aria-modal="true" aria-labelledby="coden-int-sheet-title">
      <span class="coden-int-spinner" aria-hidden="true"></span>
      <h3 id="coden-int-sheet-title">Connexion à ${escapeHtml(label)}</h3>
      <p data-sheet-text>Terminez la connexion dans la fenêtre qui vient de s’ouvrir.</p>
      <div class="coden-int-sheet-actions">
        <a class="coden-int-button is-primary" data-sheet-link hidden target="_blank" rel="noopener">Ouvrir la page de connexion</a>
        <button type="button" class="coden-int-button" data-sheet-cancel>Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const text = overlay.querySelector<HTMLElement>('[data-sheet-text]')!;
  const cancel = overlay.querySelector<HTMLButtonElement>('[data-sheet-cancel]')!;
  const link = overlay.querySelector<HTMLAnchorElement>('[data-sheet-link]')!;
  const spinner = overlay.querySelector<HTMLElement>('.coden-int-spinner')!;
  let cancelHandler: (() => void) | null = null;
  cancel.addEventListener('click', () => (cancelHandler ? cancelHandler() : close()));
  const close = () => overlay.remove();
  window.requestAnimationFrame(() => overlay.classList.add('is-open'));
  return {
    onCancel(handler: () => void) { cancelHandler = handler; },
    offerLink(url: string) {
      link.href = url;
      link.hidden = false;
      text.textContent = 'Votre navigateur a bloqué la fenêtre. Ouvrez la page de connexion, puis revenez ici.';
    },
    checking() { text.textContent = 'Vérification de la connexion…'; link.hidden = true; },
    done(name: string) {
      spinner.dataset.state = 'done';
      text.textContent = `${name} est connecté.`;
      cancel.hidden = true;
    },
    fail(message: string) {
      spinner.dataset.state = 'error';
      text.textContent = message;
      link.hidden = true;
      cancelHandler = null;
      cancel.textContent = 'Fermer';
      cancel.hidden = false;
      cancel.focus();
    },
    close,
  };
}

// ─── Grid ───────────────────────────────────────────────────────────────────

type GridOptions = {
  search?: string;
  /** Called after a toolkit is connected from this grid. */
  onConnected?: (toolkit: IntegrationToolkit) => void;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initials(name: string) {
  return name.split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase() || '·';
}

/**
 * Mounts the grid in `root`. Returns a function that re-reads the
 * connections (used when the host view becomes visible again).
 */
export function mountIntegrationsGrid(root: HTMLElement, options: GridOptions = {}): () => Promise<void> {
  installStyles();
  root.classList.add('coden-int');
  root.innerHTML = `
    <div class="coden-int-toolbar">
      <label class="coden-int-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
        <span class="coden-int-sr">Rechercher une intégration</span>
        <input type="search" data-int-search placeholder="Rechercher : Supabase, Stripe, Notion…" autocomplete="off" value="${escapeHtml(options.search || '')}">
      </label>
    </div>
    <div class="coden-int-categories" role="tablist" aria-label="Catégories" data-int-categories></div>
    <div class="coden-int-notice" data-int-notice hidden></div>
    <div class="coden-int-grid" data-int-grid aria-live="polite"></div>
    <div class="coden-int-more"><button type="button" class="coden-int-button" data-int-more hidden>Afficher plus</button></div>`;

  const grid = root.querySelector<HTMLElement>('[data-int-grid]')!;
  const categoriesEl = root.querySelector<HTMLElement>('[data-int-categories]')!;
  const notice = root.querySelector<HTMLElement>('[data-int-notice]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-int-more]')!;
  const searchInput = root.querySelector<HTMLInputElement>('[data-int-search]')!;

  const state = {
    search: options.search || '',
    category: '',
    cursor: null as string | null,
    items: [] as IntegrationToolkit[],
    connections: [] as Connection[],
    loading: false,
    request: 0,
  };

  const connectionFor = (slug: string) => {
    const matching = state.connections.filter(item => item.toolkit === slug);
    return matching.find(item => item.status === ACTIVE) || matching.find(item => PENDING.has(item.status)) || null;
  };

  const cardMarkup = (toolkit: IntegrationToolkit) => {
    const connection = connectionFor(toolkit.slug);
    const connected = connection?.status === ACTIVE;
    const pending = Boolean(connection && PENDING.has(connection.status));
    const status = connected ? 'Connecté' : pending ? 'En attente' : 'Non connecté';
    const logo = toolkit.logo
      ? `<img src="${escapeHtml(toolkit.logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : `<span>${escapeHtml(initials(toolkit.name))}</span>`;
    const category = toolkit.categories[0]?.name || '';
    return `
      <article class="coden-int-card" data-int-card="${escapeHtml(toolkit.slug)}" data-state="${connected ? 'connected' : pending ? 'pending' : 'idle'}">
        <div class="coden-int-card-head">
          <div class="coden-int-logo">${logo}</div>
          <div class="coden-int-card-title">
            <h4>${escapeHtml(toolkit.name)}</h4>
            ${category ? `<small>${escapeHtml(category)}</small>` : ''}
          </div>
          <span class="coden-int-status" data-state="${connected ? 'connected' : pending ? 'pending' : 'idle'}">${status}</span>
        </div>
        <p>${escapeHtml(toolkit.description || 'Service disponible via Composio.')}</p>
        <div class="coden-int-card-actions">
          ${connected
            ? `<button type="button" class="coden-int-button" data-int-disconnect="${escapeHtml(connection!.id)}" data-int-slug="${escapeHtml(toolkit.slug)}">Déconnecter</button>`
            : `<button type="button" class="coden-int-button is-primary" data-int-connect="${escapeHtml(toolkit.slug)}"${toolkit.managed ? '' : ' disabled title="Ce service demande une configuration personnalisée que Coden ne propose pas encore."'}>${pending ? 'Reprendre' : 'Connecter'}</button>`}
        </div>
      </article>`;
  };

  const renderGrid = () => {
    if (!state.items.length && !state.loading) {
      grid.innerHTML = `<div class="coden-int-empty">${state.search || state.category ? 'Aucune intégration ne correspond à cette recherche.' : 'Aucune intégration disponible pour le moment.'}</div>`;
      return;
    }
    // Connected services first, the rest in Composio's popularity order.
    const ordered = [...state.items].sort((a, b) => Number(connectionFor(b.slug)?.status === ACTIVE) - Number(connectionFor(a.slug)?.status === ACTIVE));
    grid.innerHTML = ordered.map(cardMarkup).join('') + (state.loading ? Array.from({ length: state.items.length ? 3 : 9 }, () => '<div class="coden-int-card is-skeleton" aria-hidden="true"></div>').join('') : '');
    more.hidden = !state.cursor || state.loading;
  };

  const showNotice = (message: string, tone: 'info' | 'error' = 'info') => {
    notice.hidden = !message;
    notice.textContent = message;
    notice.dataset.tone = tone;
  };

  const load = async (append = false) => {
    const request = ++state.request;
    state.loading = true;
    if (!append) { state.items = []; state.cursor = null; }
    renderGrid();
    try {
      const page = await fetchToolkits({ search: state.search, category: state.category, cursor: append ? state.cursor : null });
      if (request !== state.request) return;
      state.items = append ? [...state.items, ...page.items.filter(item => !state.items.some(existing => existing.slug === item.slug))] : page.items;
      state.cursor = page.nextCursor;
      showNotice('');
    } catch (error) {
      if (request !== state.request) return;
      showNotice(error instanceof Error ? error.message : 'Le catalogue n’a pas pu être chargé.', 'error');
    } finally {
      if (request === state.request) {
        state.loading = false;
        renderGrid();
      }
    }
  };

  const refreshConnections = async () => {
    try {
      state.connections = await fetchConnections();
      renderGrid();
    } catch { /* the catalogue stays usable */ }
  };

  const renderCategories = (categories: Array<{ id: string; name: string }>) => {
    const chips = [{ id: '', name: 'Toutes' }, ...categories.slice(0, 24)];
    categoriesEl.innerHTML = chips.map(category => `<button type="button" role="tab" class="coden-int-chip${category.id === state.category ? ' is-active' : ''}" aria-selected="${category.id === state.category}" data-int-category="${escapeHtml(category.id)}">${escapeHtml(category.name)}</button>`).join('');
  };

  let searchTimer = 0;
  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = searchInput.value.trim();
      void load();
    }, 280);
  });

  root.addEventListener('click', async event => {
    const target = event.target as HTMLElement;
    const chip = target.closest<HTMLButtonElement>('[data-int-category]');
    if (chip) {
      state.category = chip.dataset.intCategory || '';
      categoriesEl.querySelectorAll<HTMLButtonElement>('[data-int-category]').forEach(button => {
        const active = button === chip;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
      });
      void load();
      return;
    }
    if (target.closest('[data-int-more]')) { void load(true); return; }
    const connect = target.closest<HTMLButtonElement>('[data-int-connect]');
    if (connect && !connect.disabled) {
      const slug = connect.dataset.intConnect || '';
      const toolkit = state.items.find(item => item.slug === slug);
      connect.disabled = true;
      const result = await connectToolkit(slug, toolkit?.name || slug);
      await refreshConnections();
      if (result === 'connected' && toolkit) options.onConnected?.(toolkit);
      return;
    }
    const disconnect = target.closest<HTMLButtonElement>('[data-int-disconnect]');
    if (disconnect) {
      // Two steps, so a stray click never removes a connection.
      if (disconnect.dataset.confirming !== 'true') {
        disconnect.dataset.confirming = 'true';
        disconnect.textContent = 'Confirmer ?';
        disconnect.classList.add('is-danger');
        window.setTimeout(() => {
          if (!disconnect.isConnected) return;
          disconnect.dataset.confirming = '';
          disconnect.textContent = 'Déconnecter';
          disconnect.classList.remove('is-danger');
        }, 3500);
        return;
      }
      disconnect.disabled = true;
      disconnect.textContent = 'Déconnexion…';
      try {
        await apiFetch(`/api/integrations/connections/${encodeURIComponent(disconnect.dataset.intDisconnect || '')}`, { method: 'DELETE' });
        document.dispatchEvent(new CustomEvent('coden:integrations-changed', { detail: { toolkit: disconnect.dataset.intSlug, connected: false } }));
      } catch (error) {
        showNotice(error instanceof Error ? error.message : 'La déconnexion a échoué.', 'error');
      }
      await refreshConnections();
    }
  });

  void (async () => {
    state.loading = true;
    renderGrid();
    if (!(await integrationsConfigured())) {
      state.loading = false;
      root.querySelector('.coden-int-toolbar')?.setAttribute('hidden', '');
      categoriesEl.hidden = true;
      grid.innerHTML = '<div class="coden-int-empty"><strong>Les intégrations arrivent bientôt.</strong><span>Composio n’est pas encore configuré sur ce serveur. Coden Cloud reste disponible pour la base de données, l’authentification et le stockage.</span></div>';
      return;
    }
    void fetchCategories().then(renderCategories).catch(() => renderCategories([]));
    await Promise.all([load(), refreshConnections()]);
  })();

  return refreshConnections;
}

// ─── Modal ──────────────────────────────────────────────────────────────────

let openModal: { close: (connected: IntegrationToolkit | null) => void } | null = null;

/**
 * The grid in a dialog. Resolves with the toolkit connected from it when the
 * caller asked to stop at the first connection, else with null when closed.
 */
export function openIntegrationsModal(options: { search?: string; title?: string; subtitle?: string; resolveOnConnect?: boolean } = {}): Promise<IntegrationToolkit | null> {
  openModal?.close(null);
  installStyles();
  const previousFocus = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'coden-int-modal-overlay';
  overlay.innerHTML = `
    <section class="coden-int-modal" role="dialog" aria-modal="true" aria-labelledby="coden-int-modal-title">
      <header class="coden-int-modal-head">
        <div>
          <h2 id="coden-int-modal-title">${escapeHtml(options.title || 'Intégrations')}</h2>
          <p>${escapeHtml(options.subtitle || 'Connectez vos services. Coden les utilise dans vos sessions, avec votre accord.')}</p>
        </div>
        <button type="button" class="coden-int-icon-button" data-int-close aria-label="Fermer">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
        </button>
      </header>
      <div class="coden-int-modal-body" data-int-root></div>
    </section>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  return new Promise(resolve => {
    let done = false;
    const close = (connected: IntegrationToolkit | null) => {
      if (done) return;
      done = true;
      openModal = null;
      overlay.classList.remove('is-open');
      document.removeEventListener('keydown', onKey);
      window.setTimeout(() => overlay.remove(), 180);
      document.body.style.overflow = '';
      previousFocus?.focus?.();
      resolve(connected);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.coden-int-sheet-overlay')) close(null);
    };
    openModal = { close };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', event => {
      if (event.target === overlay || (event.target as HTMLElement).closest('[data-int-close]')) close(null);
    });
    mountIntegrationsGrid(overlay.querySelector<HTMLElement>('[data-int-root]')!, {
      search: options.search,
      onConnected: toolkit => { if (options.resolveOnConnect) close(toolkit); },
    });
    window.requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      overlay.querySelector<HTMLInputElement>('[data-int-search]')?.focus();
    });
  });
}

// ─── Styles ─────────────────────────────────────────────────────────────────

let stylesInstalled = false;
function installStyles() {
  if (stylesInstalled || document.getElementById('coden-integrations-style')) { stylesInstalled = true; return; }
  stylesInstalled = true;
  const style = document.createElement('style');
  style.id = 'coden-integrations-style';
  style.textContent = `
    .coden-int { display: grid; gap: 14px; min-width: 0; }
    .coden-int-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .coden-int-toolbar[hidden] { display: none; }
    .coden-int-search { position: relative; display: flex; align-items: center; }
    .coden-int-search svg { position: absolute; left: 12px; width: 16px; height: 16px; fill: none; stroke: var(--text-muted); stroke-width: 2; stroke-linecap: round; pointer-events: none; }
    .coden-int-search input { width: 100%; height: var(--control-height, 38px); padding: 0 12px 0 36px; border: 1px solid var(--border); border-radius: var(--radius-control, 10px); background: var(--surface); color: var(--foreground); font: inherit; font-size: 13px; outline: none; transition: border-color var(--transition-control, 140ms ease), box-shadow var(--transition-control, 140ms ease); }
    .coden-int-search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .coden-int-categories { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
    .coden-int-categories::-webkit-scrollbar { display: none; }
    .coden-int-categories[hidden] { display: none; }
    .coden-int-chip { flex: none; height: 30px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-full, 999px); background: var(--surface); color: var(--text-secondary); font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; transition: background var(--transition-micro, 120ms ease), color var(--transition-micro, 120ms ease), border-color var(--transition-micro, 120ms ease); }
    .coden-int-chip:hover { background: var(--surface-hover, var(--surface-soft)); color: var(--foreground); }
    .coden-int-chip.is-active { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
    .coden-int-chip:focus-visible, .coden-int-button:focus-visible, .coden-int-icon-button:focus-visible { outline: 2px solid var(--ring, var(--accent)); outline-offset: 2px; }
    .coden-int-notice { padding: 10px 12px; border-radius: var(--radius-control, 10px); background: var(--surface-soft); color: var(--text-secondary); font-size: 12px; }
    .coden-int-notice[data-tone="error"] { background: var(--danger-background, var(--surface-soft)); color: var(--danger); }
    .coden-int-notice[hidden] { display: none; }
    .coden-int-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
    .coden-int-card { display: grid; grid-template-rows: auto 1fr auto; gap: 10px; min-height: 148px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-lg, 14px); background: var(--surface); transition: border-color var(--transition-control, 140ms ease), box-shadow var(--transition-control, 140ms ease), transform var(--transition-control, 140ms ease); }
    .coden-int-card:hover { border-color: var(--border-strong, var(--border)); box-shadow: var(--shadow-sm); }
    .coden-int-card[data-state="connected"] { border-color: color-mix(in srgb, var(--success) 40%, var(--border)); }
    .coden-int-card.is-skeleton { background: linear-gradient(90deg, var(--surface-soft), var(--surface), var(--surface-soft)); background-size: 200% 100%; animation: coden-int-shimmer 1.2s ease-in-out infinite; }
    @keyframes coden-int-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
    @media (prefers-reduced-motion: reduce) { .coden-int-card.is-skeleton { animation: none; } }
    .coden-int-card-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .coden-int-logo { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; overflow: hidden; border: 1px solid var(--border-subtle, var(--border)); background: var(--surface-soft); color: var(--foreground); font-size: 12px; font-weight: 800; }
    .coden-int-logo img { width: 24px; height: 24px; object-fit: contain; }
    .coden-int-card-title { min-width: 0; }
    .coden-int-card-title h4 { margin: 0; overflow: hidden; color: var(--foreground); font-size: 14px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .coden-int-card-title small { display: block; overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .coden-int-status { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: var(--radius-full, 999px); background: var(--surface-soft); color: var(--text-muted); font-size: 10.5px; font-weight: 750; white-space: nowrap; }
    .coden-int-status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .7; }
    .coden-int-status[data-state="connected"] { background: var(--success-background, var(--surface-soft)); color: var(--success); }
    .coden-int-status[data-state="pending"] { color: var(--syntax-orange, var(--text-secondary)); }
    .coden-int-card p { display: -webkit-box; margin: 0; overflow: hidden; color: var(--text-secondary); font-size: 12px; line-height: 1.5; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .coden-int-card-actions { display: flex; justify-content: flex-end; }
    .coden-int-button { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-control, 10px); background: var(--surface); color: var(--foreground); font: inherit; font-size: 12px; font-weight: 700; text-decoration: none; cursor: pointer; transition: background var(--transition-micro, 120ms ease), border-color var(--transition-micro, 120ms ease), transform var(--transition-micro, 120ms ease); }
    .coden-int-button:hover:not(:disabled) { background: var(--surface-hover, var(--surface-soft)); }
    .coden-int-button.is-primary { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
    .coden-int-button.is-primary:hover:not(:disabled) { background: var(--accent); box-shadow: var(--shadow-accent); }
    .coden-int-button.is-danger { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); background: var(--danger-background, var(--surface)); color: var(--danger); }
    .coden-int-button:disabled { opacity: .5; cursor: not-allowed; }
    .coden-int-button[hidden] { display: none; }
    .coden-int-more { display: flex; justify-content: center; }
    .coden-int-empty { grid-column: 1 / -1; display: grid; gap: 4px; padding: 28px 16px; border: 1px dashed var(--border); border-radius: var(--radius-lg, 14px); color: var(--text-secondary); font-size: 13px; text-align: center; }
    .coden-int-empty strong { color: var(--foreground); }
    .coden-int-modal-overlay, .coden-int-sheet-overlay { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 16px; background: var(--overlay); opacity: 0; transition: opacity 180ms var(--ease-standard, ease); }
    .coden-int-sheet-overlay { z-index: 2147483001; }
    .coden-int-modal-overlay.is-open, .coden-int-sheet-overlay.is-open { opacity: 1; }
    .coden-int-modal { display: grid; grid-template-rows: auto minmax(0, 1fr); width: min(960px, 100%); max-height: min(760px, calc(100vh - 32px)); overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-xl, 18px); background: var(--background); box-shadow: var(--shadow-overlay, var(--shadow-lg)); transform: translateY(8px) scale(.985); transition: transform 220ms var(--ease-standard, ease); }
    .coden-int-modal-overlay.is-open .coden-int-modal { transform: none; }
    .coden-int-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 22px 14px; border-bottom: 1px solid var(--border-subtle, var(--border)); }
    .coden-int-modal-head h2 { margin: 0; color: var(--foreground); font-size: 18px; font-weight: 800; letter-spacing: -.01em; }
    .coden-int-modal-head p { margin: 4px 0 0; color: var(--text-secondary); font-size: 13px; }
    .coden-int-modal-body { overflow-y: auto; padding: 16px 22px 22px; }
    .coden-int-icon-button { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border: 1px solid var(--border); border-radius: var(--radius-control, 10px); background: var(--surface); color: var(--text-secondary); cursor: pointer; }
    .coden-int-icon-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .coden-int-sheet { display: grid; justify-items: center; gap: 8px; width: min(380px, 100%); padding: 24px; border: 1px solid var(--border); border-radius: var(--radius-xl, 18px); background: var(--background); box-shadow: var(--shadow-overlay, var(--shadow-lg)); text-align: center; }
    .coden-int-sheet h3 { margin: 6px 0 0; color: var(--foreground); font-size: 16px; }
    .coden-int-sheet p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
    .coden-int-sheet-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 8px; }
    .coden-int-spinner { width: 28px; height: 28px; border: 3px solid var(--accent-soft); border-top-color: var(--accent); border-radius: 50%; animation: coden-int-spin .8s linear infinite; }
    .coden-int-spinner[data-state="done"] { border-color: var(--success); animation: none; }
    .coden-int-spinner[data-state="error"] { border-color: var(--danger); animation: none; }
    @keyframes coden-int-spin { to { transform: rotate(360deg); } }
    @media (max-width: 560px) {
      .coden-int-modal-overlay { padding: 0; align-items: end; }
      .coden-int-modal { width: 100%; max-height: 92vh; border-radius: var(--radius-xl, 18px) var(--radius-xl, 18px) 0 0; }
      .coden-int-modal-head { padding: 16px; }
      .coden-int-modal-body { padding: 12px 16px 20px; }
      .coden-int-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
}
