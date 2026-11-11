'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const listeners = new Set<() => void>();

const read = (): Theme =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light';

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Theme lives on <html class="dark">; the inline script in layout sets it pre-paint. */
export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribe, read, () => 'dark');

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* storage unavailable - theme still applies for this session */
    }
    listeners.forEach((l) => l());
  }, []);

  return { theme, setTheme };
}
