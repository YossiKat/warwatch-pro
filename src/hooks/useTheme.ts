import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'dark' | 'light' | 'tactical';

const THEME_KEY = 'warroom-theme';

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return (saved as ThemeMode) || 'dark';
  });

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ['dark', 'light', 'tactical'];
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % 3]);
  }, [theme, setTheme]);

  return { theme, setTheme, cycleTheme };
}
