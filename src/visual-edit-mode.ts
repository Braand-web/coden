/**
 * Visual edit: point at an element of the preview, then say what to change.
 *
 * The preview is a generated app in a sandboxed frame, so the builder cannot read or style its document. The app is
 * served with a small inspector (services/sandbox/preview-inspector-script.ts) and the two talk by `postMessage`:
 * this side switches the mode on and off and receives a description of the element that was clicked.
 *
 * What comes back is untrusted (it is produced by a page the person generated, or by whatever that page embeds): it
 * is only accepted from the preview's own window, every field is bounded, and nothing in it is ever written as markup.
 *
 * The pick becomes a sentence that begins « Modifie cet élément de la page : … » — the form the agents already
 * recognise (services/preview-tool/preview-policy.ts) and answer with their `inspect` tool, which finds the element
 * and the file it comes from — and a visible scope: which element will change, and that the rest will not.
 */

export const PICKER_CHANNEL = 'picker';

export interface VisualEditTarget {
  /** A CSS selector for the element, from the page's `main` down: precise enough to find it again. */
  path: string;
  /** The short form (`button.cta`). */
  selector: string;
  /** Tag name, lowercased. */
  tag: string;
  /** Trimmed visible text. */
  text: string;
  /** aria-label, alt, title or placeholder. */
  label: string;
  /** A bounded piece of the element's markup, for the agent. */
  html: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Natural-language edit instruction prefilled for the composer. */
  instruction: string;
}

export type PickerEvent =
  | { type: 'ready' }
  | { type: 'cancelled' }
  | { type: 'selected'; target: VisualEditTarget };

export function truncate(value: string, max = 60) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The sentence the composer is prefilled with; its first words are what the agents look for. */
export function buildInstruction(target: Pick<VisualEditTarget, 'path' | 'selector' | 'tag' | 'text' | 'label'>, french: boolean): string {
  const name = target.text || target.label;
  const where = name ? `${target.tag} « ${truncate(name, 60)} » (${target.path || target.selector})` : `${target.path || target.selector}`;
  return french
    ? `Modifie cet élément de la page : ${where}. `
    : `Edit this element on the page: ${where}. `;
}

const text = (value: unknown, max: number) => truncate(typeof value === 'string' ? value : '', max);
const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? Math.max(-100_000, Math.min(100_000, Math.round(n))) : 0; };
/** A tag name, nothing else: it ends up in a sentence the agent reads. */
const TAG = /^[a-z][a-z0-9-]{0,30}$/;
/** Selectors are written by the page: only the characters of a selector are let through. */
const SELECTOR_SAFE = /[^A-Za-z0-9_\-#.:()> À-ſ]/g;

export function sanitizeTarget(raw: unknown, french = true): VisualEditTarget | null {
  const row = (raw && typeof raw === 'object' ? raw : null) as Record<string, any> | null;
  if (!row) return null;
  const tag = String(row.tag || '').toLowerCase();
  if (!TAG.test(tag)) return null;
  const selector = String(row.selector || '').replace(SELECTOR_SAFE, '').slice(0, 120);
  const path = String(row.path || '').replace(SELECTOR_SAFE, '').slice(0, 240);
  if (!selector && !path) return null;
  const rect = (row.rect && typeof row.rect === 'object' ? row.rect : {}) as Record<string, unknown>;
  const base = { path: path || selector, selector: selector || path, tag, text: text(row.text, 80), label: text(row.label, 80) };
  return { ...base, html: text(row.html, 400), rect: { x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) }, instruction: buildInstruction(base, french) };
}

/** What the person is told about the scope of the change, before they type it. */
export function scopeSummary(target: Pick<VisualEditTarget, 'tag' | 'text' | 'label' | 'path'>, french = true): { title: string; where: string; scope: string } {
  const name = target.text || target.label;
  return {
    title: name ? `${target.tag} « ${truncate(name, 40)} »` : target.tag,
    where: target.path,
    scope: french
      ? 'Seul cet élément, avec le code qui l’affiche, sera modifié. Le reste de l’application reste tel quel.'
      : 'Only this element, with the code that renders it, will change. The rest of the app stays as it is.',
  };
}

/** A message from the preview, accepted only from the preview's own window and only in the expected shape. */
export function parsePickerMessage(event: { source: unknown; data: unknown }, previewWindow: unknown, french = true): PickerEvent | null {
  if (!previewWindow || event.source !== previewWindow) return null;
  const data = event.data as Record<string, any> | null;
  if (!data || typeof data !== 'object' || data.__coden !== PICKER_CHANNEL) return null;
  if (data.type === 'ready') return { type: 'ready' };
  if (data.type === 'cancelled') return { type: 'cancelled' };
  if (data.type === 'selected') {
    const target = sanitizeTarget(data.target, french);
    return target ? { type: 'selected', target } : null;
  }
  return null;
}

export interface PreviewPicker {
  /** Switch the mode on or off; returns whether it is on. */
  toggle(): boolean;
  stop(): void;
  /** Take the outline off the element that was chosen. */
  clearSelection(): void;
  readonly active: boolean;
  dispose(): void;
}

export function createPreviewPicker(options: {
  getIframe: () => HTMLIFrameElement | null;
  isFrench: () => boolean;
  onPick: (target: VisualEditTarget) => void;
  /** The mode ended without a pick (Escape), or ended by a pick: keep the button in step. */
  onChange?: (active: boolean) => void;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}): PreviewPicker {
  const host = options.target || window;
  let active = false;
  const post = (message: Record<string, unknown>) => {
    try { options.getIframe()?.contentWindow?.postMessage({ __coden: PICKER_CHANNEL, ...message }, '*'); } catch { /* the frame is gone */ }
  };
  const setActive = (next: boolean) => {
    active = next;
    post({ type: 'mode', on: next });
    options.onChange?.(next);
  };
  const onMessage = (event: Event) => {
    const message = event as MessageEvent;
    const parsed = parsePickerMessage(message, options.getIframe()?.contentWindow, options.isFrench());
    if (!parsed) return;
    if (parsed.type === 'selected') { active = false; options.onChange?.(false); options.onPick(parsed.target); }
    else if (parsed.type === 'cancelled') { active = false; options.onChange?.(false); }
  };
  host.addEventListener('message', onMessage);
  return {
    toggle() { setActive(!active); return active; },
    stop() { if (active) setActive(false); },
    clearSelection() { post({ type: 'clear' }); },
    get active() { return active; },
    dispose() { host.removeEventListener('message', onMessage); if (active) post({ type: 'mode', on: false }); active = false; },
  };
}
