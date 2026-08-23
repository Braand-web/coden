const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

export function focusFirst(container: HTMLElement | null): void {
  if (!container) return;
  const target = container.querySelector<HTMLElement>(FOCUSABLE);
  (target || container).focus({ preventScroll: true });
}
export function trapFocus(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== "Tab") return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!nodes.length) {
    event.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function setInertExcept(active: HTMLElement | null, root: HTMLElement = document.body): () => void {
  const previous: Array<{ element: HTMLElement; value: string | null }> = [];
  Array.from(root.children).forEach((child) => {
    if (!(child instanceof HTMLElement) || child === active || child.contains(active)) return;
    previous.push({ element: child, value: child.getAttribute("inert") });
    child.setAttribute("inert", "");
  });
  return () => previous.forEach(({ element, value }) => {
    if (value === null) element.removeAttribute("inert");
    else element.setAttribute("inert", value);
  });
}
