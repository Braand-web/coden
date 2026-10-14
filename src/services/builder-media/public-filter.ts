const SUPPLIER_URL = /https?:\/\/[^\s<>"']*(?:fal\.(?:ai|run|media)|openrouter\.ai)[^\s<>"']*/gi;
const SUPPLIER = /\b(?:fal(?:[.-]ai)?|openrouter)(?:\/[a-z0-9_./-]+)?\b/gi;
let internalModels: string[] = [];
/** Called only by the server when loading its operator-verified catalogue. */
export function registerPrivateMediaModels(models: string[]) { internalModels = [...new Set(models)].filter(Boolean); }
export function publicMediaText(text: string): string {
  let safe = text.replace(SUPPLIER_URL, '[média]').replace(SUPPLIER, 'génération de médias')
    .replace(/\b(?:FAL_[A-Z_]+|OPENROUTER_[A-Z_]+)\b/g, 'MEDIA_UNAVAILABLE');
  for (const model of internalModels) safe = safe.split(model).join('modèle média');
  return safe;
}
/** Supplier payloads are never accepted here: allowlisted DTOs are built upstream. */
export function filterPublicMediaPayload<T>(value: T): T {
  if (typeof value === 'string') return publicMediaText(value) as T;
  if (Array.isArray(value)) return value.map(filterPublicMediaPayload) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, filterPublicMediaPayload(item)])) as T;
}
/** Hold unfinished tokens, including URLs/names split across arbitrary deltas. */
export function mediaStreamFilter(emit: (text: string) => void) {
  let pending = '';
  return {
    push(delta: string) {
      pending += delta;
      const cut = Math.max(pending.lastIndexOf(' '), pending.lastIndexOf('\n'), pending.lastIndexOf('\t'));
      if (cut >= 0) { const ready = pending.slice(0, cut + 1); pending = pending.slice(cut + 1); emit(publicMediaText(ready)); }
      const token = pending.toLowerCase().replace(/^[^a-z0-9]+/, '');
      const sensitive = ['fal', 'fal.ai', 'fal-ai', 'openrouter', 'http:', 'https:', 'fal_', 'openrouter_', ...internalModels.map(m => m.toLowerCase())];
      if (pending && token && !sensitive.some(prefix => prefix.startsWith(token) || token.startsWith(prefix))) { emit(pending); pending = ''; }
      if (pending.length > 16384) pending = '[contenu masqué]';
    },
    end() { if (pending) emit(publicMediaText(pending)); pending = ''; },
  };
}
