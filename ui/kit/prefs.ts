/** Per-device display preferences (theme, four-colour deck, hand sort, haptics), kept in localStorage. */
import { useSyncExternalStore } from "react";
import type { SortMode } from "../../engine/cards";

export interface Prefs {
  theme: "dark" | "light";
  fourColor: boolean;
  handSort: SortMode;
  haptics: boolean;
}

const KEY = "gamecrow:prefs";
const DEFAULTS: Prefs = { theme: "dark", fourColor: false, handSort: "suit", haptics: true };
const listeners = new Set<() => void>();

function load(): Prefs {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<Prefs>) : {}) };
  } catch {
    return DEFAULTS;
  }
}

let current = load();

function apply(p: Prefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = p.theme;
  root.dataset.fourColor = String(p.fourColor);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", p.theme === "dark" ? "#0e1014" : "#f4f1ea");
}
apply(current);

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage may be unavailable (private mode); prefs still apply for this session.
  }
  apply(current);
  listeners.forEach((l) => l());
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const prefs = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => DEFAULTS,
  );
  return [prefs, setPrefs];
}
