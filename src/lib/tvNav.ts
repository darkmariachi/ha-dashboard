import { useEffect, useRef } from "react";

declare global {
  interface Window {
    /** Called by the Android TV shell (tv/) for the remote's Back button.
     * Returns false when there's nothing left to go back from, so the shell
     * knows to leave the app. */
    tvBack?: () => boolean;
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CLOSE = '[data-tv-close], [aria-label="Close"], [aria-label="Exit fullscreen"]';
const TEXT_INPUT = "input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select";

/** SVG too: the thermostat dial is a focusable <svg>. */
type Focusable = HTMLElement | SVGElement;

type Dir = "up" | "down" | "left" | "right";
const DIRS: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function isVisible(el: Focusable) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

/** The innermost open pop-up ([data-tv-scope]), or the screen itself — the
 * remote can only reach what's inside it, like a focus trap. */
function scopeOf(root: HTMLElement): HTMLElement {
  const scopes = root.querySelectorAll<HTMLElement>("[data-tv-scope]");
  return scopes[scopes.length - 1] ?? root;
}

function focusablesIn(scope: HTMLElement) {
  return Array.from(scope.querySelectorAll<Focusable>(FOCUSABLE)).filter(isVisible);
}

function focus(el: Focusable) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

/** Whether `to` lies in direction `dir` from `from` (Android FocusFinder's
 * rule: it has to start or end past us, not merely overlap). */
function isInDirection(from: DOMRect, to: DOMRect, dir: Dir) {
  switch (dir) {
    case "right":
      return (from.left < to.left || from.right <= to.left) && from.right < to.right;
    case "left":
      return (from.right > to.right || from.left >= to.right) && from.left > to.left;
    case "down":
      return (from.top < to.top || from.bottom <= to.top) && from.bottom < to.bottom;
    case "up":
      return (from.bottom > to.bottom || from.top >= to.bottom) && from.top > to.top;
  }
}

/** Lower is closer. Distance along the direction of travel, plus a heavy
 * penalty for how far sideways the candidate sits, so a press goes to the
 * thing you're pointing at rather than the nearest thing diagonally. */
function distance(from: DOMRect, to: DOMRect, dir: Dir) {
  const horizontal = dir === "left" || dir === "right";
  const along = horizontal
    ? dir === "right"
      ? to.left - from.right
      : from.left - to.right
    : dir === "down"
      ? to.top - from.bottom
      : from.top - to.bottom;
  const [a0, a1, b0, b1] = horizontal
    ? [from.top, from.bottom, to.top, to.bottom]
    : [from.left, from.right, to.left, to.right];
  const sideways = Math.max(0, b0 - a1, a0 - b1);
  const centers = Math.abs((a0 + a1) / 2 - (b0 + b1) / 2);
  return Math.max(0, along) + sideways * 4 + centers * 0.05;
}

/** For when there's nothing further to focus but more to read (a long log
 * in a pop-up): scrolls the first container in `scope` that still can. */
function scrollPage(scope: HTMLElement, dir: Dir) {
  if (dir !== "up" && dir !== "down") return;
  for (const el of [scope, ...scope.querySelectorAll<HTMLElement>("*")]) {
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    if (!/auto|scroll/.test(getComputedStyle(el).overflowY)) continue;
    const room = dir === "down" ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
    if (room < 1) continue;
    el.scrollBy({ top: (dir === "down" ? 0.6 : -0.6) * el.clientHeight, behavior: "smooth" });
    return;
  }
}

/** The remote's OK button: Enter in an Android TV WebView, but some remotes
 * and older WebViews report it as "Select" or the raw D-pad-center code. */
function isOk(e: KeyboardEvent) {
  return e.key === "Enter" || e.key === "Select" || e.keyCode === 23;
}

/** Sliders and text fields use left/right themselves. */
function keepsKey(el: Focusable | null, dir: Dir) {
  if (!el || (dir !== "left" && dir !== "right")) return false;
  if (el.matches('input[type=range], [role="slider"]')) return true;
  return el.matches(TEXT_INPUT) && (el as HTMLInputElement).value !== "";
}

/**
 * D-pad navigation for the TV layout: arrow keys move focus to the nearest
 * focusable element in that direction, OK/Enter presses it, and Back/Escape
 * closes the open pop-up, then returns to the tab rail ([data-tv-rail]),
 * then hands over to `onBack`. Focus follows pop-ups in and back out to
 * whatever opened them.
 */
export function useTvNav(rootRef: React.RefObject<HTMLElement | null>, onBack: () => boolean) {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // What had focus before each open pop-up, innermost last.
    const openers: Focusable[] = [];
    let followTab = false;

    function active() {
      const el = document.activeElement;
      const focusable = el instanceof HTMLElement || el instanceof SVGElement;
      return focusable && el !== document.body && root!.contains(el) ? el : null;
    }

    function defaultTarget(scope: HTMLElement) {
      const main = scope === root ? (root!.querySelector<HTMLElement>("[data-tv-main]") ?? scope) : scope;
      const all = focusablesIn(main);
      return all.find((el) => !el.matches(CLOSE)) ?? all[0] ?? focusablesIn(scope)[0];
    }

    /** Keeps focus inside the current scope as pop-ups open and close. */
    function settle() {
      const scope = scopeOf(root!);
      const current = active();
      if (current && scope.contains(current)) return;
      let target: Focusable | undefined;
      if (scope !== root) {
        if (current) openers.push(current);
      } else {
        while (!target && openers.length > 0) {
          const opener = openers.pop()!;
          if (opener.isConnected && isVisible(opener)) target = opener;
        }
      }
      target ??= defaultTarget(scope);
      if (target) focus(target);
    }

    function move(dir: Dir) {
      const scope = scopeOf(root!);
      const current = active();
      if (!current || !scope.contains(current)) return settle();
      const from = current.getBoundingClientRect();
      let best: Focusable | null = null;
      let bestScore = Infinity;
      for (const el of focusablesIn(scope)) {
        if (el === current) continue;
        const to = el.getBoundingClientRect();
        if (!isInDirection(from, to, dir)) continue;
        const score = distance(from, to, dir);
        if (score < bestScore) {
          best = el;
          bestScore = score;
        }
      }
      if (best) focus(best);
      else scrollPage(scope, dir);
    }

    function back() {
      const scope = scopeOf(root!);
      if (scope !== root) {
        const close = scope.querySelector<HTMLElement>(CLOSE);
        if (close) {
          close.click();
          return true;
        }
      }
      const rail = root!.querySelector<HTMLElement>("[data-tv-rail]");
      const currentTab = () => rail?.querySelector<HTMLElement>('[aria-current="page"]');
      if (rail && !rail.contains(document.activeElement)) {
        const tab = currentTab() ?? focusablesIn(rail)[0];
        if (tab) {
          focus(tab);
          return true;
        }
      }
      // onBack switches tabs; the highlight follows once the new one renders.
      followTab = onBackRef.current();
      return followTab;
    }

    function onKey(e: KeyboardEvent) {
      const dir = DIRS[e.key];
      if (dir) {
        if (keepsKey(active(), dir)) return;
        e.preventDefault();
        move(dir);
      } else if (isOk(e)) {
        const current = active();
        // Text fields keep Enter (submit / on-screen keyboard's Go).
        if (!current || current.matches(TEXT_INPUT)) return;
        e.preventDefault();
        // Holding OK shouldn't machine-gun a light switch.
        if (!e.repeat && current instanceof HTMLElement) current.click();
      } else if (e.key === "Escape") {
        // Capture phase + stopImmediatePropagation: Sheet listens for Escape
        // too, and one press should only go back one step.
        e.stopImmediatePropagation();
        if (back()) e.preventDefault();
      }
    }

    const observer = new MutationObserver(() => {
      if (followTab) {
        followTab = false;
        root.querySelector<HTMLElement>('[data-tv-rail] [aria-current="page"]')?.focus({ preventScroll: true });
      }
      settle();
    });
    observer.observe(root, { childList: true, subtree: true });
    settle();

    window.addEventListener("keydown", onKey, true);
    window.tvBack = back;
    return () => {
      window.removeEventListener("keydown", onKey, true);
      observer.disconnect();
      delete window.tvBack;
    };
  }, [rootRef]);
}
