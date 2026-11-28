import { useSyncExternalStore } from "react";
import { post, token } from "./push";

// Card order and collapsed cards per tab, kept by the push service
// (/api/push/layout/*) so a change on the phone shows up on every device.
// A copy lives in localStorage so the saved layout is there on launch,
// before the service answers.

export interface Layout {
  /** Card ids in the chosen order; empty = the default order. */
  order: string[];
  /** Card ids shown as a one-line bar instead of the whole card. */
  collapsed: string[];
}

const CACHE_KEY = "ha-dashboard:layouts";
const EMPTY: Layout = { order: [], collapsed: [] };

let layouts: Record<string, Layout> = loadCache();
let editing = false;
/** Writes still on their way; a fetch that lands meanwhile is stale. */
let pending = 0;
let lastFetch = 0;
const listeners = new Set<() => void>();

function loadCache(): Record<string, Layout> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function emit() {
  localStorage.setItem(CACHE_KEY, JSON.stringify(layouts));
  listeners.forEach((l) => l());
}

/** Pulls the shared layouts (at most every few seconds). */
export function refreshLayouts(force = false) {
  if (!force && Date.now() - lastFetch < 5_000) return;
  lastFetch = Date.now();
  let t: string;
  try {
    t = token();
  } catch {
    return;
  }
  post("layout/get", { token: t })
    .then((l: Record<string, Layout>) => {
      if (pending > 0 || !l || typeof l !== "object") return;
      layouts = l;
      emit();
    })
    .catch(() => {});
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshLayouts();
  });
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) refreshLayouts();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLayout(key: string): Layout {
  return useSyncExternalStore(subscribe, () => layouts[key] ?? EMPTY);
}

/** Saves one tab's layout; null puts it back to the default. */
export function setLayout(key: string, layout: Layout | null) {
  const next = { ...layouts };
  if (!layout || (layout.order.length === 0 && layout.collapsed.length === 0)) delete next[key];
  else next[key] = layout;
  layouts = next;
  emit();
  pending++;
  let t: string;
  try {
    t = token();
  } catch {
    pending--;
    return;
  }
  post("layout/set", { token: t, key, order: layout?.order ?? [], collapsed: layout?.collapsed ?? [] })
    .catch(() => {})
    .finally(() => {
      pending--;
    });
}

export function useEditingLayout(): boolean {
  return useSyncExternalStore(subscribe, () => editing);
}

export function setEditingLayout(on: boolean) {
  if (editing === on) return;
  editing = on;
  listeners.forEach((l) => l());
  if (on) refreshLayouts(true);
}

/** The default order with the saved one laid over it. A card the saved
 * order doesn't know yet (new, or renamed) keeps its default spot: right
 * after the card that comes before it by default. */
export function arrange(defaultIds: string[], saved: string[]): string[] {
  const known = new Set(defaultIds);
  const out = saved.filter((id, i) => known.has(id) && saved.indexOf(id) === i);
  const placed = new Set(out);
  defaultIds.forEach((id, i) => {
    if (placed.has(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(defaultIds[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, id);
    placed.add(id);
  });
  return out;
}
