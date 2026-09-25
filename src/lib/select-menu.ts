/**
 * A select, dressed as the product's menus — the one dropdown of Coden.
 *
 * The native <select> keeps the value: forms, pricing code and `change`
 * listeners read it exactly as before. This lays a trigger and a listbox over
 * it: arrow keys, Home/End, Enter/Space and Escape as in any listbox, a
 * highlight that travels to the row under the pointer, a check on the chosen
 * row, and each row can carry a line of its own (what that tier costs).
 *
 * The listbox is attached to <body> and placed from the trigger's position,
 * so a dialog or a scrolling card never clips it; it opens upwards when there
 * is no room below. Born on the landing's pricing; the pricing page, the
 * upgrade modal, the onboarding and Settings → Facturation use it too.
 */
import '../styles/select-menu.css';

export type SelectMenuOptions = {
  /** A second line for a value (e.g. its monthly price); '' for none. */
  describe?: (value: string) => string;
  /** Extra class on the wrapper, for a surface-specific size. */
  className?: string;
};

export type SelectMenu = { refresh: () => void; close: () => void };

const CHECK_ICON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_ICON = '<svg class="coden-select-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const handles = new WeakMap<HTMLSelectElement, SelectMenu>();
let sequence = 0;

/** Enhances `select` once; later calls return the same handle, refreshed. */
export function enhanceSelect(select: HTMLSelectElement, options: SelectMenuOptions = {}): SelectMenu {
  const existing = handles.get(select);
  if (existing) {
    existing.refresh();
    return existing;
  }
  const describe = options.describe || (() => '');
  const id = select.id || `coden-select-${(sequence += 1)}`;

  let wrapper = select.parentElement?.matches('.coden-select, [data-lp-select]') ? select.parentElement as HTMLElement : null;
  if (!wrapper) {
    wrapper = document.createElement('span');
    select.replaceWith(wrapper);
    wrapper.appendChild(select);
  }
  wrapper.classList.add('coden-select');
  if (options.className) wrapper.classList.add(options.className);
  if (!wrapper.querySelector('.coden-select-chevron')) wrapper.insertAdjacentHTML('beforeend', CHEVRON_ICON);

  /*
   * The visible label names the trigger (the select it was written for is
   * hidden from assistive tech), and a click on it opens nothing natively —
   * it focuses the trigger instead.
   */
  const label = select.labels?.[0] || null;
  let labelText: HTMLElement | null = null;
  if (label && !select.getAttribute('aria-labelledby') && !select.getAttribute('aria-label')) {
    labelText = label.contains(select) ? label.querySelector<HTMLElement>(':scope > span:not(.coden-select)') : label;
    if (labelText && !labelText.id) labelText.id = `${id}-label`;
  }
  const labelledBy = select.getAttribute('aria-labelledby') || labelText?.id || '';
  const ariaLabel = select.getAttribute('aria-label') || '';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'coden-select-trigger';
  trigger.id = `${id}-trigger`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-menu`);
  if (labelledBy) trigger.setAttribute('aria-labelledby', `${labelledBy} ${trigger.id}`);
  else if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);
  const triggerLabel = document.createElement('strong');
  const triggerMeta = document.createElement('small');
  trigger.append(triggerLabel, triggerMeta);

  const menu = document.createElement('ul');
  menu.className = 'coden-select-menu';
  menu.id = `${id}-menu`;
  menu.setAttribute('role', 'listbox');
  menu.tabIndex = -1;
  if (labelledBy) menu.setAttribute('aria-labelledby', labelledBy);
  else if (ariaLabel) menu.setAttribute('aria-label', ariaLabel);
  menu.hidden = true;
  const highlight = document.createElement('li');
  highlight.className = 'coden-select-highlight';
  highlight.setAttribute('aria-hidden', 'true');
  highlight.setAttribute('role', 'presentation');

  let rows: HTMLLIElement[] = [];
  const buildRows = () => {
    menu.replaceChildren(highlight);
    rows = Array.from(select.options).map((option, index) => {
      const row = document.createElement('li');
      row.className = 'coden-select-option';
      row.id = `${id}-option-${index}`;
      row.setAttribute('role', 'option');
      row.dataset.value = option.value;
      if (option.disabled) row.setAttribute('aria-disabled', 'true');
      row.innerHTML = `${CHECK_ICON}<span></span><small></small>`;
      row.querySelector('span')!.textContent = option.textContent || option.value;
      menu.appendChild(row);
      return row;
    });
  };
  buildRows();

  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  wrapper.classList.add('is-enhanced');
  wrapper.insertBefore(trigger, select);

  let active = select.selectedIndex;
  const moveHighlight = (index: number) => {
    const row = rows[index];
    if (!row) { highlight.style.opacity = '0'; return; }
    highlight.style.transform = `translateY(${row.offsetTop}px)`;
    highlight.style.height = `${row.offsetHeight}px`;
    highlight.style.opacity = '1';
  };
  const setActive = (index: number, scroll = true) => {
    if (!rows.length) return;
    active = Math.max(0, Math.min(rows.length - 1, index));
    menu.setAttribute('aria-activedescendant', rows[active].id);
    moveHighlight(active);
    if (scroll) rows[active].scrollIntoView({ block: 'nearest' });
  };

  /* Placed against the trigger, below it or — with no room — above it. */
  const place = () => {
    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const below = window.innerHeight - rect.bottom - gap - 12;
    const above = rect.top - gap - 12;
    const natural = Math.min(296, menu.scrollHeight || 296);
    const upward = below < Math.min(natural, 200) && above > below;
    const maxHeight = Math.max(120, Math.min(296, upward ? above : below));
    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.width = `${Math.round(rect.width)}px`;
    menu.style.maxHeight = `${Math.round(maxHeight)}px`;
    if (upward) {
      menu.style.top = '';
      menu.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
    } else {
      menu.style.bottom = '';
      menu.style.top = `${Math.round(rect.bottom + gap)}px`;
    }
    menu.dataset.side = upward ? 'top' : 'bottom';
  };

  const isOpen = () => !menu.hidden;
  const onViewportChange = (event: Event) => {
    if (!isOpen()) return;
    if (event.type === 'scroll' && menu.contains(event.target as Node)) return;
    place();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (isOpen() && !wrapper!.contains(event.target as Node) && !menu.contains(event.target as Node)) close(false);
  };
  const open = () => {
    if (isOpen() || select.disabled) return;
    document.querySelectorAll<HTMLElement>('.coden-select-menu:not([hidden])').forEach(other => {
      if (other !== menu) other.dispatchEvent(new CustomEvent('coden-select-close'));
    });
    document.body.appendChild(menu);
    menu.hidden = false;
    wrapper!.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    place();
    // No travel on opening: the highlight starts on the chosen row.
    highlight.style.transition = 'none';
    setActive(select.selectedIndex);
    void highlight.offsetWidth;
    highlight.style.transition = '';
    menu.focus({ preventScroll: true });
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    document.addEventListener('pointerdown', onPointerDown, true);
  };
  function close(returnFocus = true) {
    if (!isOpen()) return;
    menu.hidden = true;
    wrapper!.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
    document.removeEventListener('pointerdown', onPointerDown, true);
    menu.remove();
    if (returnFocus) trigger.focus({ preventScroll: true });
  }
  menu.addEventListener('coden-select-close', () => close(false));

  const choose = (index: number) => {
    if (rows[index]?.getAttribute('aria-disabled') === 'true') return;
    if (index !== select.selectedIndex) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
  };

  trigger.addEventListener('click', event => {
    event.preventDefault();
    if (isOpen()) close();
    else open();
  });
  label?.addEventListener('click', event => {
    if (trigger.contains(event.target as Node)) return;
    event.preventDefault();
    trigger.focus();
  });
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(); }
  });
  menu.addEventListener('keydown', event => {
    const last = rows.length - 1;
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: last, PageDown: active + 5, PageUp: active - 5 };
    if (event.key in moves) { event.preventDefault(); setActive(moves[event.key]); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') close(false);
  });
  menu.addEventListener('pointermove', event => {
    const row = (event.target as Element).closest<HTMLLIElement>('.coden-select-option');
    const index = row ? rows.indexOf(row) : -1;
    if (index >= 0 && index !== active) setActive(index, false);
  });
  menu.addEventListener('click', event => {
    const row = (event.target as Element).closest<HTMLLIElement>('.coden-select-option');
    if (row) choose(rows.indexOf(row));
  });

  const refresh = () => {
    // Options can be replaced after enhancement (a catalogue that loads late).
    if (rows.length !== select.options.length || rows.some((row, index) => row.dataset.value !== select.options[index]?.value)) buildRows();
    const current = select.options[select.selectedIndex];
    triggerLabel.textContent = current?.textContent || '';
    triggerMeta.textContent = describe(select.value);
    trigger.disabled = select.disabled;
    rows.forEach((row, index) => {
      row.setAttribute('aria-selected', String(index === select.selectedIndex));
      row.querySelector('span')!.textContent = select.options[index]?.textContent || row.dataset.value || '';
      row.querySelector('small')!.textContent = describe(row.dataset.value || '');
    });
  };
  select.addEventListener('change', refresh);
  refresh();

  const handle: SelectMenu = { refresh, close: () => close(false) };
  handles.set(select, handle);
  return handle;
}

/** Enhances every select matching `selector` inside `root`. */
export function enhanceSelects(root: ParentNode, selector: string, options: SelectMenuOptions | ((select: HTMLSelectElement) => SelectMenuOptions) = {}): SelectMenu[] {
  return Array.from(root.querySelectorAll<HTMLSelectElement>(selector)).map(select => enhanceSelect(select, typeof options === 'function' ? options(select) : options));
}
