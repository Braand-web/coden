/**
 * Toasts and confirmations, shared by the builder's Cloud console and the
 * admin console.
 *
 * Both used `window.confirm` for destructive actions — a browser dialog with
 * the page's origin for a title, no way to say what will be lost, and no
 * styling in either theme — and reported results as messages in the chat
 * thread, where a "secret deleted" line outlived the action by the whole
 * conversation. A toast says it once, in a corner, and leaves; a confirmation
 * names the thing and the consequence.
 *
 * Styles use the design tokens both pages define, so light and dark follow.
 */

export type ToastTone = 'success' | 'error' | 'info';

const STYLE_ID = 'coden-ui-feedback-style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.coden-toasts{position:fixed;right:16px;bottom:16px;z-index:10050;display:flex;flex-direction:column;gap:8px;max-width:min(380px,calc(100vw - 32px));pointer-events:none}
.coden-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;padding:11px 12px 11px 14px;border:1px solid var(--border,#e5e7eb);border-radius:12px;background:var(--surface,#fff);color:var(--foreground,#111);box-shadow:0 10px 30px rgba(0,0,0,.14);font:500 13px/1.45 var(--font-sans,system-ui,sans-serif);animation:coden-toast-in .18s ease-out}
.coden-toast::before{content:"";flex:0 0 8px;height:8px;margin-top:6px;border-radius:50%;background:var(--accent,#2563eb)}
.coden-toast[data-tone="success"]::before{background:var(--success,#16a34a)}
.coden-toast[data-tone="error"]{border-color:color-mix(in srgb,var(--danger,#dc2626) 45%,var(--border,#e5e7eb))}
.coden-toast[data-tone="error"]::before{background:var(--danger,#dc2626)}
.coden-toast span{flex:1;min-width:0;overflow-wrap:anywhere}
.coden-toast button{flex:0 0 auto;border:0;background:none;color:var(--text-muted,#6b7280);font-size:16px;line-height:1;padding:2px 4px;cursor:pointer;border-radius:6px}
.coden-toast button:hover{color:var(--foreground,#111)}
@keyframes coden-toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (max-width:640px){.coden-toasts{left:16px;right:16px;bottom:88px;max-width:none}}
.coden-confirm{position:fixed;inset:0;z-index:10040;display:grid;place-items:center;padding:16px;background:rgba(8,10,14,.48)}
.coden-confirm-panel{width:min(440px,100%);padding:20px;border:1px solid var(--border,#e5e7eb);border-radius:16px;background:var(--surface,#fff);color:var(--foreground,#111);box-shadow:0 24px 60px rgba(0,0,0,.25);font-family:var(--font-sans,system-ui,sans-serif)}
.coden-confirm-panel h2{margin:0 0 8px;font-size:16px;font-weight:650;letter-spacing:-.01em}
.coden-confirm-panel p{margin:0;color:var(--text-secondary,#4b5563);font-size:13.5px;line-height:1.55}
.coden-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;flex-wrap:wrap}
.coden-confirm-actions button{min-height:36px;padding:0 14px;border-radius:10px;border:1px solid var(--border,#e5e7eb);background:var(--surface,#fff);color:var(--foreground,#111);font:600 13px/1 var(--font-sans,system-ui,sans-serif);cursor:pointer}
.coden-confirm-actions button[data-confirm]{border-color:transparent;background:var(--accent,#2563eb);color:var(--text-on-accent,#fff)}
.coden-confirm-actions button[data-confirm][data-danger]{background:var(--danger,#dc2626);color:#fff}
.coden-confirm-actions button:focus-visible{outline:2px solid var(--accent,#2563eb);outline-offset:2px}
.coden-confirm-field{display:grid;gap:6px;margin-top:14px;font-size:12.5px;color:var(--text-secondary,#4b5563)}
.coden-confirm-field input{min-height:36px;padding:0 10px;border:1px solid var(--input,var(--border,#e5e7eb));border-radius:10px;background:var(--background,#fff);color:var(--foreground,#111);font:500 13px/1 var(--font-mono,ui-monospace,monospace)}
`;
  document.head.appendChild(style);
}

function toastHost(): HTMLElement {
  let host = document.getElementById('coden-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'coden-toasts';
    host.className = 'coden-toasts';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message: string, tone: ToastTone = 'info', duration = tone === 'error' ? 7000 : 3600): HTMLElement {
  ensureStyles();
  const node = document.createElement('div');
  node.className = 'coden-toast';
  node.dataset.tone = tone;
  node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fermer la notification');
  close.textContent = '×';
  close.addEventListener('click', () => node.remove());
  node.append(text, close);
  const host = toastHost();
  host.appendChild(node);
  while (host.children.length > 4) host.firstElementChild?.remove();
  if (duration > 0) window.setTimeout(() => node.remove(), duration);
  return node;
}

export type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the action stays disabled until this exact text is typed. */
  typeToConfirm?: string;
};

/** Resolves true only when the person confirms; Escape, the backdrop and Cancel all mean no. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  ensureStyles();
  document.getElementById('coden-confirm')?.remove();
  return new Promise(resolve => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.createElement('div');
    root.id = 'coden-confirm';
    root.className = 'coden-confirm';
    const panel = document.createElement('div');
    panel.className = 'coden-confirm-panel';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'coden-confirm-title');
    panel.setAttribute('aria-describedby', 'coden-confirm-body');
    const title = document.createElement('h2');
    title.id = 'coden-confirm-title';
    title.textContent = options.title;
    const body = document.createElement('p');
    body.id = 'coden-confirm-body';
    body.textContent = options.body;
    panel.append(title, body);
    let typed: HTMLInputElement | null = null;
    if (options.typeToConfirm) {
      const label = document.createElement('label');
      label.className = 'coden-confirm-field';
      label.textContent = `Tapez « ${options.typeToConfirm} » pour confirmer`;
      typed = document.createElement('input');
      typed.autocomplete = 'off';
      label.appendChild(typed);
      panel.appendChild(label);
    }
    const actions = document.createElement('div');
    actions.className = 'coden-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = options.cancelLabel || 'Annuler';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.dataset.confirm = '';
    if (options.danger) confirm.dataset.danger = '';
    confirm.textContent = options.confirmLabel || 'Confirmer';
    if (typed) {
      confirm.disabled = true;
      typed.addEventListener('input', () => { confirm.disabled = typed!.value.trim() !== options.typeToConfirm; });
    }
    actions.append(cancel, confirm);
    panel.appendChild(actions);
    root.appendChild(panel);
    const finish = (value: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); finish(false); }
      if (event.key === 'Tab') {
        const focusable = [typed, cancel, confirm].filter((el): el is HTMLInputElement | HTMLButtonElement => Boolean(el && !el.disabled));
        const index = focusable.indexOf(document.activeElement as any);
        const next = event.shiftKey ? index - 1 : index + 1;
        event.preventDefault();
        focusable[(next + focusable.length) % focusable.length]?.focus();
      }
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => { if (!confirm.disabled) finish(true); });
    root.addEventListener('mousedown', event => { if (event.target === root) finish(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);
    (typed || (options.danger ? cancel : confirm)).focus();
  });
}
