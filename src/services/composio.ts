/**
 * Composio, server side only.
 *
 * Composio hosts the OAuth apps and API-key forms for hundreds of services
 * (Supabase, Stripe, GitHub, Gmail, Notion…) and executes their tools on
 * behalf of a user it knows by an id we choose. Coden maps each of its own
 * accounts to one Composio user (`coden_<uuid>`), so connections never mix
 * between people, and the API key stays in this process: the browser only
 * ever sees toolkit metadata, connection statuses and the hosted connect URL.
 *
 * Endpoints are Composio's v3.1 REST API (the same ones @composio/client
 * calls): toolkits, toolkit categories, auth configs, connected accounts,
 * connect links, tools and tool execution.
 */

export type ComposioToolkit = {
  slug: string;
  name: string;
  description: string;
  logo: string;
  categories: Array<{ id: string; name: string }>;
  toolsCount: number;
  noAuth: boolean;
  /** Composio can connect it with its own managed OAuth app or form. */
  managed: boolean;
};

export type ComposioConnection = {
  id: string;
  toolkit: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ComposioTool = {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
  parameters: unknown;
};

export class ComposioError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'ComposioError';
    this.status = status;
  }
}

const DEFAULT_BASE_URL = 'https://backend.composio.dev';
const TIMEOUT_MS = 15_000;

export function composioConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(env.COMPOSIO_API_KEY || '').trim());
}

/** One Composio user per Coden account, never shared. */
export function composioUserId(codenUserId: string): string {
  const id = String(codenUserId || '').trim();
  if (!/^[0-9a-f-]{16,64}$/i.test(id)) throw new ComposioError('A signed-in Coden account is required.', 401);
  return `coden_${id.toLowerCase()}`;
}

/** Toolkit slugs are lower-case identifiers; anything else never reaches the API. */
export function normalizeToolkitSlug(value: unknown): string {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug) ? slug : '';
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

async function composioRequest<T>(path: string, options: { method?: string; query?: Query; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const apiKey = String(process.env.COMPOSIO_API_KEY || '').trim();
  if (!apiKey) throw new ComposioError('Composio is not configured on this server.', 503);
  const url = new URL(path, process.env.COMPOSIO_BASE_URL || DEFAULT_BASE_URL);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value === undefined || value === null || value === '') continue;
    // Composio reads arrays comma-separated.
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'x-api-key': apiKey,
        accept: 'application/json',
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal,
    });
  } catch (error: any) {
    throw new ComposioError(error?.name === 'TimeoutError' ? 'Composio did not answer in time.' : 'Composio is unreachable.', 504);
  }
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const message = String(payload?.error?.message || payload?.message || payload?.error || `Composio answered ${response.status}.`).slice(0, 300);
    // The key is ours, not the user's: an auth failure is a server problem.
    throw new ComposioError(response.status === 401 || response.status === 403 ? 'Composio rejected this server\'s API key.' : message, response.status === 404 ? 404 : response.status >= 500 ? 502 : response.status === 401 || response.status === 403 ? 503 : 400);
  }
  return payload as T;
}

// ─── Catalogue ──────────────────────────────────────────────────────────────

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 400) cache.delete(cache.keys().next().value as string);
  return value;
}

function toToolkit(item: any): ComposioToolkit | null {
  const slug = normalizeToolkitSlug(item?.slug);
  if (!slug) return null;
  const managedSchemes = Array.isArray(item?.composio_managed_auth_schemes) ? item.composio_managed_auth_schemes : [];
  return {
    slug,
    name: String(item?.name || slug).slice(0, 80),
    description: String(item?.meta?.description || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    logo: /^https:\/\//.test(String(item?.meta?.logo || '')) ? String(item.meta.logo) : '',
    categories: (Array.isArray(item?.meta?.categories) ? item.meta.categories : [])
      .map((category: any) => ({ id: String(category?.id || category?.slug || category?.name || '').slice(0, 60), name: String(category?.name || '').slice(0, 60) }))
      .filter((category: { id: string; name: string }) => category.id && category.name)
      .slice(0, 4),
    toolsCount: Number(item?.meta?.tools_count || 0) || 0,
    noAuth: item?.no_auth === true,
    managed: item?.no_auth === true || managedSchemes.length > 0,
  };
}

export async function listToolkits(input: { search?: string; category?: string; cursor?: string; limit?: number } = {}) {
  const search = String(input.search || '').trim().slice(0, 80);
  const category = String(input.category || '').trim().slice(0, 60);
  const cursor = String(input.cursor || '').trim().slice(0, 200);
  const limit = Math.max(6, Math.min(60, Number(input.limit) || 30));
  return cached(`toolkits:${search}:${category}:${cursor}:${limit}`, 10 * 60_000, async () => {
    const payload = await composioRequest<any>('/api/v3.1/toolkits', {
      query: { search: search || undefined, category: category || undefined, cursor: cursor || undefined, limit, sort_by: 'usage', include_deprecated: false },
    });
    const items = (Array.isArray(payload?.items) ? payload.items : []).map(toToolkit).filter(Boolean) as ComposioToolkit[];
    return { items, nextCursor: payload?.next_cursor ? String(payload.next_cursor) : null, total: Number(payload?.total_items || items.length) };
  });
}

export async function getToolkit(slug: string): Promise<ComposioToolkit | null> {
  const clean = normalizeToolkitSlug(slug);
  if (!clean) return null;
  return cached(`toolkit:${clean}`, 30 * 60_000, async () => {
    try {
      return toToolkit(await composioRequest<any>(`/api/v3.1/toolkits/${encodeURIComponent(clean)}`));
    } catch (error) {
      if (error instanceof ComposioError && error.status === 404) return null;
      throw error;
    }
  });
}

export async function listToolkitCategories(): Promise<Array<{ id: string; name: string }>> {
  return cached('categories', 60 * 60_000, async () => {
    const payload = await composioRequest<any>('/api/v3.1/toolkits/categories');
    return (Array.isArray(payload?.items) ? payload.items : [])
      .map((item: any) => ({ id: String(item?.id || item?.slug || '').slice(0, 60), name: String(item?.name || '').slice(0, 60) }))
      .filter((item: { id: string; name: string }) => item.id && item.name);
  });
}

// ─── Connections ────────────────────────────────────────────────────────────

/** Status Composio reports for a usable connection. */
export const ACTIVE_STATUS = 'ACTIVE';

export async function listConnections(codenUserId: string): Promise<ComposioConnection[]> {
  const payload = await composioRequest<any>('/api/v3.1/connected_accounts', {
    query: { user_ids: [composioUserId(codenUserId)], limit: 200 },
  });
  return (Array.isArray(payload?.items) ? payload.items : [])
    .filter((item: any) => item?.is_disabled !== true)
    .map((item: any) => ({
      id: String(item?.id || ''),
      toolkit: normalizeToolkitSlug(item?.toolkit?.slug),
      status: String(item?.status || '').toUpperCase(),
      createdAt: item?.created_at || null,
      updatedAt: item?.updated_at || null,
    }))
    .filter((item: ComposioConnection) => item.id && item.toolkit);
}

/**
 * Every connection in the Composio project, for the admin panel: which
 * services are connected and by how many accounts. The Coden account is
 * recovered from the Composio user id; nothing else about it is read.
 */
export async function listAllConnections(limit = 500): Promise<Array<ComposioConnection & { codenUserId: string | null }>> {
  const payload = await composioRequest<any>('/api/v3.1/connected_accounts', { query: { limit: Math.max(1, Math.min(1000, limit)) } });
  return (Array.isArray(payload?.items) ? payload.items : [])
    .map((item: any) => {
      const composioUser = String(item?.user_id || '');
      return {
        id: String(item?.id || ''),
        toolkit: normalizeToolkitSlug(item?.toolkit?.slug),
        status: String(item?.status || '').toUpperCase(),
        createdAt: item?.created_at || null,
        updatedAt: item?.updated_at || null,
        codenUserId: composioUser.startsWith('coden_') ? composioUser.slice('coden_'.length) : null,
      };
    })
    .filter((item: ComposioConnection) => item.id && item.toolkit);
}

const activeToolkitCache = new Map<string, { at: number; value: string[] }>();
/** The toolkits this person has an ACTIVE connection to; cached briefly, '[]' on any failure. */
export async function activeToolkits(codenUserId: string, options: { fresh?: boolean } = {}): Promise<string[]> {
  if (!composioConfigured()) return [];
  const hit = activeToolkitCache.get(codenUserId);
  if (!options.fresh && hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const value = [...new Set((await listConnections(codenUserId)).filter(item => item.status === ACTIVE_STATUS).map(item => item.toolkit))].sort();
    activeToolkitCache.set(codenUserId, { at: Date.now(), value });
    return value;
  } catch {
    return hit?.value || [];
  }
}

export function forgetActiveToolkits(codenUserId: string) {
  activeToolkitCache.delete(codenUserId);
}

const authConfigIds = new Map<string, string>();

/** The Composio-managed auth config for a toolkit, created on first use. */
async function managedAuthConfigId(toolkit: string): Promise<string> {
  const known = authConfigIds.get(toolkit);
  if (known) return known;
  const existing = await composioRequest<any>('/api/v3.1/auth_configs', { query: { toolkit_slug: toolkit, is_composio_managed: true, limit: 20 } });
  const reusable = (Array.isArray(existing?.items) ? existing.items : [])
    .find((item: any) => normalizeToolkitSlug(item?.toolkit?.slug) === toolkit && String(item?.status || 'ENABLED').toUpperCase() !== 'DISABLED');
  let id = String(reusable?.id || '');
  if (!id) {
    const created = await composioRequest<any>('/api/v3.1/auth_configs', {
      method: 'POST',
      body: { toolkit: { slug: toolkit }, auth_config: { type: 'use_composio_managed_auth' } },
    });
    id = String(created?.auth_config?.id || '');
  }
  if (!id) throw new ComposioError(`Composio cannot connect ${toolkit} with a managed configuration.`, 400);
  authConfigIds.set(toolkit, id);
  return id;
}

/**
 * A hosted connect page for this person and toolkit. The browser opens
 * `redirectUrl` in a popup; Composio sends it back to `callbackUrl` when done.
 */
export async function createConnectLink(input: { codenUserId: string; toolkit: string; callbackUrl?: string }) {
  const toolkit = normalizeToolkitSlug(input.toolkit);
  if (!toolkit) throw new ComposioError('Unknown integration.', 400);
  const authConfigId = await managedAuthConfigId(toolkit);
  const payload = await composioRequest<any>('/api/v3.1/connected_accounts/link', {
    method: 'POST',
    body: {
      auth_config_id: authConfigId,
      user_id: composioUserId(input.codenUserId),
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
    },
  });
  const redirectUrl = String(payload?.redirect_url || '');
  if (!/^https:\/\//.test(redirectUrl)) throw new ComposioError('Composio did not return a connection page.', 502);
  forgetActiveToolkits(input.codenUserId);
  return { redirectUrl, connectedAccountId: String(payload?.connected_account_id || ''), expiresAt: payload?.expires_at || null };
}

/** Deletes a connection, after checking it belongs to this person. */
export async function disconnect(codenUserId: string, connectionId: string) {
  const id = String(connectionId || '').trim();
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new ComposioError('Unknown connection.', 404);
  const account = await composioRequest<any>(`/api/v3.1/connected_accounts/${encodeURIComponent(id)}`);
  if (String(account?.user_id || '') !== composioUserId(codenUserId)) throw new ComposioError('Unknown connection.', 404);
  await composioRequest<any>(`/api/v3.1/connected_accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  forgetActiveToolkits(codenUserId);
}

// ─── Tools, for the agent ───────────────────────────────────────────────────

export async function listTools(toolkit: string, search?: string): Promise<ComposioTool[]> {
  const slug = normalizeToolkitSlug(toolkit);
  if (!slug) return [];
  const query = String(search || '').trim().slice(0, 80);
  return cached(`tools:${slug}:${query}`, 30 * 60_000, async () => {
    const payload = await composioRequest<any>('/api/v3.1/tools', {
      query: { toolkit_slug: slug, search: query || undefined, limit: query ? 20 : 40, ...(query ? {} : { important: 'true' }) },
    });
    return (Array.isArray(payload?.items) ? payload.items : []).map((item: any) => ({
      slug: String(item?.slug || ''),
      name: String(item?.name || item?.slug || ''),
      description: String(item?.description || '').replace(/\s+/g, ' ').slice(0, 300),
      toolkit: normalizeToolkitSlug(item?.toolkit?.slug) || slug,
      parameters: item?.input_parameters || {},
    })).filter((tool: ComposioTool) => /^[A-Z0-9_]{3,120}$/.test(tool.slug));
  });
}

/**
 * Tools that act on the outside world rather than read from it. The agent may
 * only run them when the person asked for that action in their own request.
 */
export function isOutwardTool(slug: string): boolean {
  return /(^|_)(SEND|REPLY|FORWARD|DELETE|REMOVE|DESTROY|DROP|TRUNCATE|CHARGE|PAY|PAYOUT|REFUND|TRANSFER|CANCEL|ARCHIVE|REVOKE|PUBLISH|POST|INVITE|MERGE|UPDATE_BILLING|CREATE_PAYMENT|CREATE_CHARGE|CREATE_INVOICE|EXECUTE_SQL|RUN_SQL)(_|$)/.test(slug);
}

export async function executeTool(input: { codenUserId: string; tool: string; arguments: Record<string, unknown> }) {
  const tool = String(input.tool || '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{3,120}$/.test(tool)) throw new ComposioError('Unknown tool.', 400);
  const payload = await composioRequest<any>(`/api/v3.1/tools/execute/${encodeURIComponent(tool)}`, {
    method: 'POST',
    body: { user_id: composioUserId(input.codenUserId), arguments: input.arguments || {} },
  });
  return { successful: payload?.successful === true, data: payload?.data ?? null, error: payload?.error ? String(payload.error).slice(0, 500) : null };
}

// ─── Services the agent may ask for ─────────────────────────────────────────

export type ServiceNeed = 'database' | 'payments' | 'email' | 'storage' | 'auth' | 'other';

/**
 * What the chat offers when an app needs a service it does not have.
 * `coden_cloud` provisions Coden's own backend; a toolkit opens Composio's
 * connect page; `browse` opens the integrations catalogue, pre-searched.
 */
export const SERVICE_CHOICES: Record<ServiceNeed, { question: string; options: Array<{ label: string; kind: 'coden_cloud' | 'toolkit' | 'browse'; toolkit?: string; search?: string }> }> = {
  database: {
    question: 'Ton app a besoin d’une base de données. Que veux-tu utiliser ?',
    options: [
      { label: 'Coden Cloud', kind: 'coden_cloud' },
      { label: 'Supabase', kind: 'toolkit', toolkit: 'supabase' },
      { label: 'Autre base de données', kind: 'browse', search: 'database' },
    ],
  },
  auth: {
    question: 'Ton app a besoin de comptes utilisateurs. Quelle authentification veux-tu utiliser ?',
    options: [
      { label: 'Coden Cloud', kind: 'coden_cloud' },
      { label: 'Supabase', kind: 'toolkit', toolkit: 'supabase' },
      { label: 'Autre service', kind: 'browse', search: 'auth' },
    ],
  },
  storage: {
    question: 'Ton app doit stocker des fichiers. Où veux-tu les garder ?',
    options: [
      { label: 'Coden Cloud', kind: 'coden_cloud' },
      { label: 'Supabase', kind: 'toolkit', toolkit: 'supabase' },
      { label: 'Autre stockage', kind: 'browse', search: 'storage' },
    ],
  },
  payments: {
    question: 'Ton app doit encaisser des paiements. Quel service veux-tu utiliser ?',
    options: [
      { label: 'Stripe', kind: 'toolkit', toolkit: 'stripe' },
      { label: 'Autre moyen de paiement', kind: 'browse', search: 'payment' },
    ],
  },
  email: {
    question: 'Ton app doit envoyer des e-mails. Quel service veux-tu utiliser ?',
    options: [
      { label: 'Gmail', kind: 'toolkit', toolkit: 'gmail' },
      { label: 'SendGrid', kind: 'toolkit', toolkit: 'sendgrid' },
      { label: 'Autre service d’e-mail', kind: 'browse', search: 'email' },
    ],
  },
  other: {
    question: 'Ton app a besoin d’un service externe. Lequel veux-tu connecter ?',
    options: [
      { label: 'Choisir dans les intégrations', kind: 'browse' },
    ],
  },
};
