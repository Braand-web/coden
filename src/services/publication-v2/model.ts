import { createHash, randomBytes } from 'node:crypto';
import type { PublishSettings } from '../../shared/publish.ts';
import { RESERVED_SUBDOMAINS } from '../domain-service.ts';

export type PublicationFile = { path: string; content: string; encoding?: 'base64' };
export type PublicationSnapshot = {
  id: string;
  project_id: string;
  actor_id: string;
  settings: PublishSettings;
  files: PublicationFile[];
  manifest: Record<string, any>;
  public_env: Record<string, string>;
  fingerprint: string;
  publication_generation?: number;
  restored_from?: string;
  hosts?: string[];
};
export type PublicationState = {
  project_id: string;
  hosting_id: string;
  draft: PublishSettings;
  effective: PublishSettings | null;
  release_id: string | null;
  fingerprint: string | null;
  enabled: boolean;
  removal_pending?: boolean;
  generation?: number;
};
export class PublicationError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

export function normalizePublishSettings(value: unknown, workspaceAllowed: boolean): PublishSettings {
  const v = value as Partial<PublishSettings>;
  if (!v || typeof v !== 'object') throw new PublicationError('INVALID_SETTINGS', 'Paramètres de publication manquants.', 400);
  const subdomain = String(v.subdomain || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(subdomain) || RESERVED_SUBDOMAINS.has(subdomain)) {
    throw new PublicationError('INVALID_SUBDOMAIN', 'Choisissez une adresse de 3 à 48 lettres, chiffres ou tirets, non réservée.', 400);
  }
  const audience = v.audience;
  if (audience !== 'public' && audience !== 'invite_only' && audience !== 'workspace') throw new PublicationError('INVALID_AUDIENCE', 'Audience invalide.', 400);
  if (v.audience === 'workspace' && !workspaceAllowed) throw new PublicationError('WORKSPACE_PLAN_REQUIRED', 'L’audience Espace de travail nécessite Business.', 403);
  if (!Array.isArray(v.invitations) || v.invitations.length > 100) throw new PublicationError('INVALID_INVITATIONS', 'Ajoutez au maximum 100 adresses.', 400);
  const invitations = [...new Set(v.invitations.map(email => String(email).trim().toLowerCase()))].sort();
  if (invitations.some(email => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new PublicationError('INVALID_EMAIL', 'Une adresse d’invitation est invalide.', 400);
  const title = String(v.metadata?.title || '').trim();
  const description = String(v.metadata?.description || '').trim();
  if (!title || title.length > 120 || description.length > 320) throw new PublicationError('INVALID_METADATA', 'Titre requis (120 caractères maximum), description limitée à 320 caractères.', 400);
  const asset = (value: unknown): string | null => {
    if (!value) return null;
    const path = String(value);
    // Project-owned asset path only: never fetch arbitrary URLs or inline executable data.
    if (path.length > 512 || !/^\/(?!\/)[a-zA-Z0-9_./%-]+$/.test(path) || /(?:%2e|%2f|%5c|\.\.)/i.test(path)) throw new PublicationError('INVALID_METADATA_ASSET', 'Sélectionnez un fichier du projet avec un chemin commençant par /.', 400);
    return path;
  };
  return { subdomain, audience, invitations, metadata: { title, description, favicon: asset(v.metadata?.favicon), image: asset(v.metadata?.image) } };
}

export function suggestedSettings(project: { id: string; name: string; slug?: string }): PublishSettings {
  const suffix = project.id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const base = String(project.slug || project.name || 'projet').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'projet';
  return { subdomain: `${base}-${suffix}`, audience: 'public', invitations: [], metadata: { title: project.name || 'Mon application', description: '', favicon: null, image: null } };
}
export function sourcePublicationMetadata(files: PublicationFile[], fallbackTitle: string): PublishSettings['metadata'] {
  const html = files.find(file => /(?:^|\/)index\.html?$/i.test(file.path))?.content || '';
  const decode = (value: string) => value.replace(/&(?:amp|lt|gt|quot|#39);/g, token => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[token]!)).trim();
  const attributes = (tag: string) => Object.fromEntries(Array.from(tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g), match => [match[1].toLowerCase(), decode(match[2])]));
  const tags = (html.match(/<meta\b[^>]*>/gi) || []).map(attributes);
  const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  const localAsset = (value: string | undefined) => value && /^\/(?!\/)[a-zA-Z0-9_./%-]+$/.test(value) && !/(?:%2e|%2f|%5c|\.\.)/i.test(value) && value.length <= 512 ? value : null;
  const favicon = (html.match(/<link\b[^>]*>/gi) || []).map(attributes).find(link => /(?:^|\s)icon(?:\s|$)/i.test(link.rel || ''))?.href;
  return { title: (title && !/^(?:vite(?:\s*\+\s*react)?|react app|coden)$/i.test(title) ? title : fallbackTitle).slice(0, 120), description: (tags.find(tag => tag.name === 'description')?.content || '').slice(0, 320), favicon: localAsset(favicon), image: localAsset(tags.find(tag => tag.property === 'og:image')?.content) };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function publicationFingerprint(input: Pick<PublicationSnapshot, 'files' | 'settings' | 'manifest' | 'public_env'>): string {
  // generatedAt is diagnostic, not a source change.
  const { generatedAt: _ignored, ...manifest } = input.manifest;
  const files = [...input.files].sort((a, b) => a.path.localeCompare(b.path));
  return createHash('sha256').update(JSON.stringify(canonical({ settings: input.settings, public_env: input.public_env, files, manifest }))).digest('hex');
}
export function tokenDigest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function newOpaqueToken(): string { return randomBytes(32).toString('base64url'); }
export function safeReturnPath(value: unknown): string {
  const path = String(value || '/');
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n\u0000]/.test(path) || /%0[ad]|%5c/i.test(path)) return '/';
  return path.slice(0, 2048);
}
export function canonicalHost(value: unknown): string {
  const host = String(value || '').trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) || host.length > 253) throw new PublicationError('INVALID_HOST', 'Adresse du site invalide.', 400);
  return host;
}

const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function applyPublicationMetadata(html: string, settings: PublishSettings, url: string, releaseId?: string): string {
  const tags = [
    `<title>${esc(settings.metadata.title)}</title>`,
    `<meta name="description" content="${esc(settings.metadata.description)}">`,
    `<meta property="og:title" content="${esc(settings.metadata.title)}">`,
    `<meta property="og:description" content="${esc(settings.metadata.description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    ...(settings.metadata.favicon ? [`<link rel="icon" href="${esc(settings.metadata.favicon)}">`] : []),
    ...(settings.metadata.image ? [`<meta property="og:image" content="${esc(new URL(settings.metadata.image, url).href)}">`] : []),
    ...(releaseId ? [`<meta name="coden-release" content="${esc(releaseId)}">`] : []),
  ];
  // Scan actual head tokens. Global replacements would corrupt tag-shaped text
  // inside application scripts, templates, comments or body SVG.
  let cursor = 0, head = -1, htmlOpen = -1, templateDepth = 0;
  const remove: Array<[number, number]> = [];
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) { const end = html.indexOf('-->', start + 4); cursor = end < 0 ? html.length : end + 3; continue; }
    const match = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/i.exec(html.slice(start));
    if (!match) { cursor = start + 1; continue; }
    const closing = !!match[1], name = match[2].toLowerCase();
    let end = start + match[0].length, quote = '';
    for (; end < html.length; end++) { const c = html[end]; if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') { end++; break; } }
    cursor = end;
    if (name === 'html' && !closing && head < 0) htmlOpen = end;
    if (name === 'head' && !templateDepth) { if (closing) break; if (head < 0) head = end; continue; }
    if (name === 'template') { templateDepth += closing ? -1 : 1; templateDepth = Math.max(0, templateDepth); continue; }
    if (!closing && /^(?:script|style|textarea|xmp|iframe|noembed|noframes|noscript|title)$/.test(name)) {
      const close = new RegExp(`<\\/\\s*${name}\\s*>`, 'ig'); close.lastIndex = end;
      const found = close.exec(html); const rawEnd = found ? close.lastIndex : html.length;
      if (head >= 0 && !templateDepth && name === 'title') remove.push([start, rawEnd]);
      cursor = rawEnd; continue;
    }
    if (head < 0 || templateDepth || closing) continue;
    if (/^(?:body|svg|div|main|section|p|h[1-6])$/.test(name)) break;
    const raw = html.slice(start, end);
    const attrs = Object.fromEntries(Array.from(raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g), m => [m[1].toLowerCase(), (m[2] ?? m[3] ?? m[4]).toLowerCase()]));
    if (name === 'meta' && (/^(?:description|og:(?:title|description|url|image))$/.test(attrs.name || attrs.property || '') || (releaseId && attrs.name === 'coden-release'))) remove.push([start, end]);
    if (name === 'link' && /^(?:canonical|icon|shortcut icon)$/.test(attrs.rel || '')) remove.push([start, end]);
  }
  if (head < 0) { const at = htmlOpen >= 0 ? htmlOpen : (/^\s*<!doctype[^>]*>/i.exec(html)?.[0].length || 0); return `${html.slice(0, at)}<head>${tags.join('\n')}</head>${html.slice(at)}`; }
  let output = `${html.slice(0, head)}\n${tags.join('\n')}\n`, position = head;
  for (const [start, end] of remove) { output += html.slice(position, start); position = end; }
  return output + html.slice(position);
}
