/**
 * Input preferences. Deliberately separate from view state: these describe how
 * *you* like to fly, not what is on screen, so they must not ride along in a
 * shared link and change someone else's controls.
 */

const KEY = 'aether.prefs.v1';

export type ZoomAnchor = 'cursor' | 'centre';

export interface Prefs {
  zoomAnchor: ZoomAnchor;
}

export function defaultPrefs(): Prefs {
  return { zoomAnchor: 'cursor' };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultPrefs();
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      zoomAnchor: p.zoomAnchor === 'centre' ? 'centre' : 'cursor',
    };
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable — the session still works */
  }
}
