import { useState, useEffect, useRef } from 'react';

/**
 * Like useState but persists value to localStorage under the given key.
 * Reads initial value from localStorage if present.
 */
export function usePersistedState<T>(key: string, initial: T) {
  const storageKey = `lov:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* ignore quota / private mode */
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}
