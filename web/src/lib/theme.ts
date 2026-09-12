export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'kimchi-theme';

export function isTheme(value: string | null | undefined): value is Theme {
  return value === 'light' || value === 'dark';
}

function getSafeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredTheme(): Theme | null {
  const storage = getSafeStorage();
  if (!storage) {
    return null;
  }
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function resolveTheme(stored: Theme | null, prefersDark: boolean): Theme {
  if (stored !== null) {
    return stored;
  }
  return prefersDark ? 'dark' : 'light';
}

export function toggleThemeValue(current: Theme): Theme {
  return current === 'light' ? 'dark' : 'light';
}

export function applyThemeToRoot(theme: Theme, root: HTMLElement): void {
  root.setAttribute('data-theme', theme);
}

export function persistTheme(theme: Theme): void {
  const storage = getSafeStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (Safari privacy mode, sandboxed iframe, etc.)
  }
}
