/** "My Presets" — a small local list of saved views. Never leaves the browser. */

import type { ViewState } from './urlstate.ts';

const KEY = 'aether.personal.v2';
const LIMIT = 40;

export interface PersonalPreset {
  name: string;
  state: ViewState;
}

export function loadPersonal(): PersonalPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersonalPreset[]) : [];
  } catch {
    return [];
  }
}

function persist(list: PersonalPreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    /* storage unavailable — the in-memory list still works for this session */
  }
}

export function savePersonal(name: string, state: ViewState): PersonalPreset[] {
  const list = loadPersonal();
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return list;
  const existing = list.findIndex((p) => p.name === trimmed);
  if (existing >= 0) list[existing] = { name: trimmed, state };
  else list.unshift({ name: trimmed, state });
  persist(list);
  return list;
}

export function deletePersonal(name: string): PersonalPreset[] {
  const list = loadPersonal().filter((p) => p.name !== name);
  persist(list);
  return list;
}
