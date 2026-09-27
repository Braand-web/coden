export type CodenTheme = 'dark' | 'light';

export const CODEN_THEME_KEY = 'coden-theme';

export type CodenThemePreference = CodenTheme | 'system';

let systemThemeListenerBound = false;

function isTheme(value: string | null): value is CodenTheme {
  return value === 'dark' || value === 'light';
}

function getStoredTheme(): CodenTheme | null {
  try {
    const stored = localStorage.getItem(CODEN_THEME_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(): CodenTheme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function getInitialTheme(): CodenTheme {
  return getStoredTheme() || getSystemTheme();
}

export function applyTheme(theme: CodenTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const background = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  if (themeColor && background) themeColor.content = background;

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
  const transition = (document as Document & {
    startViewTransition?: (callback: () => void) => { finished?: Promise<unknown> };
  }).startViewTransition;
  if (typeof transition === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    try {
      const viewTransition = transition.call(document, () => applyTheme(next));
      void viewTransition?.finished?.catch(() => undefined);
    } catch {
      applyTheme(next);
    }
  } else {
    applyTheme(next);
  }
  return next;
}

export function setThemePreference(preference: CodenThemePreference): CodenTheme {
  try {
    if (preference === 'system') localStorage.removeItem(CODEN_THEME_KEY);
    else localStorage.setItem(CODEN_THEME_KEY, preference);
  } catch { /* the selected theme still applies for this page */ }

  const theme = preference === 'system' ? getSystemTheme() : preference;
  applyTheme(theme);
  return theme;
}

export function initThemeController(): CodenTheme {
  const initial = getInitialTheme();
  applyTheme(initial);

  if (!systemThemeListenerBound) {
    systemThemeListenerBound = true;
    try {
      window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
        if (!getStoredTheme()) applyTheme(event.matches ? 'dark' : 'light');
      });
    } catch { /* system preference still applies on the next page load */ }

    window.addEventListener('storage', (event) => {
      if (event.key && event.key !== CODEN_THEME_KEY) return;
      applyTheme(getStoredTheme() || getSystemTheme());
    });
  }

  document.querySelectorAll<HTMLElement>('[data-theme-toggle], #theme-btn, #theme-btn-dashboard').forEach((button) => {
    if (button.dataset.themeBound === 'true') return;
    button.dataset.themeBound = 'true';
    button.addEventListener('click', () => toggleTheme());
  });

  return initial;
}
