export type CodenTheme = 'dark' | 'light';

export const CODEN_THEME_KEY = 'coden-theme';

function isTheme(value: string | null): value is CodenTheme {
  return value === 'dark' || value === 'light';
}

export function getInitialTheme(): CodenTheme {
  try {
    const stored = localStorage.getItem(CODEN_THEME_KEY);
    return isTheme(stored) ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: CodenTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === 'dark' ? '#0f1014' : '#fafafa';

  document.querySelectorAll<HTMLElement>('[data-theme-icon="dark"], #moon-icon').forEach((icon) => {
    icon.classList.toggle('hidden', theme !== 'dark');
    icon.style.display = theme === 'dark' ? '' : 'none';
  });
  document.querySelectorAll<HTMLElement>('[data-theme-icon="light"], #sun-icon').forEach((icon) => {
    icon.classList.toggle('hidden', theme === 'dark');
    icon.style.display = theme === 'dark' ? 'none' : '';
  });

  document.querySelectorAll<HTMLElement>('[data-theme-toggle], #theme-btn, #theme-btn-dashboard').forEach((button) => {
    button.setAttribute('aria-label', theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre');
    button.setAttribute('title', theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre');
    button.setAttribute('data-current-theme', theme);
  });
}

export function toggleTheme(): CodenTheme {
  const current = document.documentElement.getAttribute('data-theme');
  const next: CodenTheme = current === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(CODEN_THEME_KEY, next); } catch { /* theme remains applied for this session */ }
  const transition = (document as Document & { startViewTransition?: (callback: () => void) => unknown }).startViewTransition;
  if (typeof transition === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    transition(() => applyTheme(next));
  } else {
    applyTheme(next);
  }
  return next;
}

export function initThemeController(): CodenTheme {
  const initial = getInitialTheme();
  applyTheme(initial);

  document.querySelectorAll<HTMLElement>('[data-theme-toggle], #theme-btn, #theme-btn-dashboard').forEach((button) => {
    if (button.dataset.themeBound === 'true') return;
    button.dataset.themeBound = 'true';
    button.addEventListener('click', () => toggleTheme());
  });

  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== CODEN_THEME_KEY) return;
    if (isTheme(event.newValue)) applyTheme(event.newValue);
  });

  return initial;
}
