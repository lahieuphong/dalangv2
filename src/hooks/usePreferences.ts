import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { loadSettings, saveSettings, type Settings } from '../app/settings';

/** Settings persisted to localStorage. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => saveSettings(settings), [settings]);
  const update = useCallback((patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch })), []);
  return [settings, update];
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** True on small screens, where the overlays start out in their compact form. */
export const useCompactLayout = () => useMediaQuery('(max-width: 720px), (max-height: 560px)');
