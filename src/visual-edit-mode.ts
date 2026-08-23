/**
 * Coden Visual Edit Mode
 *
 * First increment of issue #1 (direct visual editing): lets the user click an
 * element inside the live preview iframe to target a scoped edit instead of
 * writing a full prompt. The clicked element is described with a stable,
 * human-readable selector + its visible text, which is fed back into the
 * builder composer as a precise edit instruction (handled by the existing
 * autonomous edit path).
 *
 * This module is self-contained and side-effect free until `initVisualEditMode`
 * is called. It never mutates the generated files directly; it only produces an
 * edit instruction string so the normal generation/edit pipeline stays the
 * single source of truth.
 */

export interface VisualEditTarget {
  /** Stable CSS-ish selector for the clicked element. */
  selector: string;
  /** Tag name, lowercased. */
  tag: string;
  /** Trimmed visible text (truncated). */
  text: string;
  /** Natural-language edit instruction prefilled for the composer. */
  instruction: string;
}

export interface VisualEditOptions {
  /** Returns the live preview iframe, or null when none is mounted. */
  getIframe: () => HTMLIFrameElement | null;
  /** Called with a ready-to-send edit instruction when the user picks an element. */
  onPick: (target: VisualEditTarget) => void;
  /** True when the user language is French (instruction wording). */
  isFrench: () => boolean;
}

const OVERLAY_ID = 'coden-visual-edit-overlay';
const STYLE_ID = 'coden-visual-edit-style';

export function truncate(value: string, max = 60) {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
}

/**
 * Builds a short, stable selector for an element: prefers id, then a class
 * combination, then nth-of-type within the parent. Kept human-readable so the
 * LLM can reliably locate the same element in the source.
 */
function describeSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id) return `${tag}#${id}`;
  const className = (el.getAttribute('class') || '')
    .split(/\s+/)
    .filter(Boolean)
    // Drop utility-heavy / hashed classes that are not stable anchors.
    .filter((c) => c.length <= 24 && !/^(css-|sc-)/.test(c))
    .slice(0, 2)
    .join('.');
  if (className) return `${tag}.${className}`;
  const parent = el.parentElement;
  if (parent) {
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (sameTag.length > 1) {
      const index = sameTag.indexOf(el) + 1;
      return `${tag}:nth-of-type(${index})`;
    }
  }
  return tag;
}

export function buildInstruction(target: Omit<VisualEditTarget, 'instruction'>, french: boolean): string {
  const label = target.text ? `"${target.text}"` : target.tag;
  const where = target.text
    ? `${target.tag} ${label} (${target.selector})`
    : `${target.selector}`;
  return french
    ? `Modifie cet \u00e9l\u00e9ment de la page : ${where}. `
    : `Edit this element on the page: ${where}. `;
}

let active = false;
let cleanup: (() => void) | null = null;

/**
 * Toggles visual edit mode. Returns the new active state.
 * Safe to call repeatedly; re-binds against the current iframe document.
 */
export function setVisualEditMode(enabled: boolean, options: VisualEditOptions): boolean {
  if (!enabled) {
    cleanup?.();
    cleanup = null;
    active = false;
    return false;
  }

  const iframe = options.getIframe();
  const doc = iframe?.contentDocument;
  if (!iframe || !doc) {
    active = false;
    return false;
  }

  // Tear down any previous binding before re-arming.
  cleanup?.();

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        pointer-events: none;
        z-index: 2147483647;
        border: 2px solid #2f6df6;
        border-radius: 6px;
        background: rgba(47, 109, 246, 0.08);
        box-shadow: 0 0 0 2px rgba(47, 109, 246, 0.18);
        transition: color 60ms ease-out, background-color 60ms ease-out, border-color 60ms ease-out, box-shadow 60ms ease-out, opacity 60ms ease-out, transform 60ms ease-out, filter 60ms ease-out;
        opacity: 0;
      }
      html[data-coden-visual-edit="on"] * { cursor: crosshair !important; }
    `;
    doc.head?.appendChild(style);
  }

  let overlay = doc.getElementById(OVERLAY_ID) as HTMLElement | null;
  if (!overlay) {
    overlay = doc.createElement('div');
    overlay.id = OVERLAY_ID;
    doc.body?.appendChild(overlay);
  }
  doc.documentElement.setAttribute('data-coden-visual-edit', 'on');

  const moveOverlay = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (!overlay) return;
    overlay.style.opacity = '1';
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  };

  const onMove = (event: Event) => {
    const el = event.target as Element | null;
    if (el && el.nodeType === 1 && el.id !== OVERLAY_ID) moveOverlay(el);
  };

  const onClick = (event: MouseEvent) => {
    const el = event.target as Element | null;
    if (!el || el.nodeType !== 1 || el.id === OVERLAY_ID) return;
    event.preventDefault();
    event.stopPropagation();
    const base = {
      selector: describeSelector(el),
      tag: el.tagName.toLowerCase(),
      text: truncate((el as HTMLElement).innerText || el.textContent || ''),
    };
    const target: VisualEditTarget = {
      ...base,
      instruction: buildInstruction(base, options.isFrench()),
    };
    // Picking an element exits the mode so the user can type the change.
    setVisualEditMode(false, options);
    options.onPick(target);
    // Let the host UI re-sync any toggle button state.
    try {
      document.dispatchEvent(new CustomEvent('coden:visual-edit-picked'));
    } catch {
      /* CustomEvent unavailable */
    }
  };

  doc.addEventListener('mouseover', onMove, true);
  doc.addEventListener('click', onClick, true);

  cleanup = () => {
    doc.removeEventListener('mouseover', onMove, true);
    doc.removeEventListener('click', onClick, true);
    doc.documentElement.removeAttribute('data-coden-visual-edit');
    doc.getElementById(OVERLAY_ID)?.remove();
  };

  active = true;
  return true;
}

export function isVisualEditModeActive(): boolean {
  return active;
}

/**
 * Convenience initializer: wires a toggle button to visual edit mode.
 * The button gets `aria-pressed` reflecting the current state.
 */
export function initVisualEditMode(toggle: HTMLElement, options: VisualEditOptions): void {
  const sync = () => toggle.setAttribute('aria-pressed', String(isVisualEditModeActive()));
  toggle.addEventListener('click', () => {
    const next = !isVisualEditModeActive();
    setVisualEditMode(next, options);
    sync();
  });
  sync();
}
