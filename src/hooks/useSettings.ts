import { useCallback, useEffect, useState } from 'react';

import type { AppSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';
import { loadSettings, saveSettings } from '../storage/repositories';

/** App settings, persisted to IndexedDB and reflected onto the document root. */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((stored) => {
        if (!cancelled) setSettings(stored);
      })
      .catch(() => {
        /* Storage unavailable: fall back to defaults, which are already set. */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.fontSize = settings.fontSize;
    root.dataset.contentWidth = settings.contentWidth;
  }, [settings.fontSize, settings.contentWidth]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      void saveSettings(next).catch(() => undefined);
      return next;
    });
  }, []);

  return { settings, updateSettings: update, settingsLoaded: loaded };
}
