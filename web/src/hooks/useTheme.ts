import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyThemeToRoot,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  toggleThemeValue,
  type Theme,
} from '../lib/theme';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function getSystemPrefersDark(): boolean {
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

export interface UseThemeResult {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  hasUserPreference: boolean;
}

export function useTheme(): UseThemeResult {
  const hasUserPreferenceRef = useRef(readStoredTheme() !== null);

  const [theme, setThemeState] = useState<Theme>(() =>
    resolveTheme(readStoredTheme(), getSystemPrefersDark()),
  );

  useEffect(() => {
    applyThemeToRoot(theme, document.documentElement);
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);

    const handleSystemThemeChange = () => {
      if (hasUserPreferenceRef.current) {
        return;
      }
      setThemeState(resolveTheme(null, mediaQuery.matches));
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    hasUserPreferenceRef.current = true;
    persistTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(toggleThemeValue(theme));
  }, [setTheme, theme]);

  return {
    theme,
    setTheme,
    toggleTheme,
    hasUserPreference: hasUserPreferenceRef.current,
  };
}
