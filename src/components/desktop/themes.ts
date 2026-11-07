import { useCallback, useState } from "react";
import { C } from "./ui";

/**
 * Desktop themes. Each one swaps the palette (the dx-* tokens and the C
 * object used for SVG / inline colors) and, through `data-dx-theme` on the
 * root, its own CSS in themes.css: fonts, panel shapes, borders, title
 * treatment and background effects. The color slots keep their names
 * (cyan, pink…) but each theme fills them with its own six accents.
 */

export interface Palette {
  bg: string;
  panel: string;
  raise: string;
  line: string;
  text: string;
  dim: string;
  faint: string;
  cyan: string;
  pink: string;
  violet: string;
  amber: string;
  green: string;
  red: string;
}

export interface DesktopTheme {
  id: string;
  name: string;
  /** What it's styled after, for the picker. */
  inspiredBy: string;
  tagline: string;
  palette: Palette;
  /** The accent the chrome (active nav, panel ticks, logo) uses. */
  primary: keyof Palette;
  /** The logo tile's letter(s). */
  mark: string;
}

export const DESKTOP_THEMES: DesktopTheme[] = [
  {
    id: "neon",
    name: "Neon Ops",
    inspiredBy: "the original",
    tagline: "Dark console, cyan and magenta glow",
    primary: "cyan",
    mark: "H",
    palette: {
      bg: "#06070c",
      panel: "#0d0f18",
      raise: "#141725",
      line: "rgba(255, 255, 255, 0.07)",
      text: "#e9ebf7",
      dim: "#7f84a0",
      faint: "#484c66",
      cyan: "#21e6f2",
      pink: "#ff2fa8",
      violet: "#a35bff",
      amber: "#ffb020",
      green: "#2ef2a3",
      red: "#ff4d6d",
    },
  },
  {
    id: "netrunner",
    name: "Netrunner",
    inspiredBy: "Cyberpunk 2077",
    tagline: "Hazard yellow, cut corners, scanlines and glitch",
    primary: "amber",
    mark: "//",
    palette: {
      bg: "#07080b",
      panel: "#0e0f14",
      raise: "#16171e",
      line: "rgba(252, 238, 10, 0.13)",
      text: "#eceadf",
      dim: "#8f8c78",
      faint: "#4d4b3e",
      cyan: "#00f0ff",
      pink: "#ff2a6d",
      violet: "#c64bff",
      amber: "#fcee0a",
      green: "#05ffa1",
      red: "#ff3b3b",
    },
  },
  {
    id: "vice",
    name: "Ocean Drive",
    inspiredBy: "GTA Vice City",
    tagline: "Miami sunset, palm-pink and teal, synthwave grid",
    primary: "pink",
    mark: "V",
    palette: {
      bg: "#140a26",
      panel: "rgba(28, 12, 48, 0.93)",
      raise: "#2a1747",
      line: "rgba(255, 120, 200, 0.16)",
      text: "#fff1fb",
      dim: "#b796c9",
      faint: "#6c5486",
      cyan: "#2de2e6",
      pink: "#ff3f9f",
      violet: "#9b6dff",
      amber: "#ffa53d",
      green: "#3df5b0",
      red: "#ff4365",
    },
  },
  {
    id: "tactical",
    name: "Tactical",
    inspiredBy: "Valorant",
    tagline: "Off-white on navy, red slash, hard edges",
    primary: "red",
    mark: "T",
    palette: {
      bg: "#0f1923",
      panel: "#16222e",
      raise: "#1f2d3a",
      line: "rgba(236, 232, 225, 0.1)",
      text: "#ece8e1",
      dim: "#8b978f",
      faint: "#4a5862",
      cyan: "#3fd8c3",
      pink: "#ff7a85",
      violet: "#b38cff",
      amber: "#f2c45a",
      green: "#5fe0a2",
      red: "#ff4655",
    },
  },
  {
    id: "hextech",
    name: "Hextech",
    inspiredBy: "League of Legends",
    tagline: "Gilded frames, deep blue, arcane teal",
    primary: "amber",
    mark: "◆",
    palette: {
      bg: "#010a13",
      panel: "#091428",
      raise: "#0e1d33",
      line: "rgba(200, 170, 110, 0.2)",
      text: "#f0e6d2",
      dim: "#a09b8c",
      faint: "#5b5a56",
      cyan: "#0ac8b9",
      pink: "#cd5c8b",
      violet: "#8f6fd8",
      amber: "#c8aa6e",
      green: "#4fbf87",
      red: "#e84057",
    },
  },
];

const KEY = "ha-dashboard:desktop-theme";

function find(id: string | null) {
  return DESKTOP_THEMES.find((t) => t.id === id) ?? DESKTOP_THEMES[0];
}

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Points the shared C palette at a theme (components read it on render). */
function applyPalette(t: DesktopTheme) {
  const p = t.palette;
  Object.assign(C, {
    cyan: p.cyan,
    pink: p.pink,
    violet: p.violet,
    amber: p.amber,
    green: p.green,
    red: p.red,
    dim: p.dim,
    faint: p.faint,
    text: p.text,
    primary: p[t.primary],
  });
}

/** The CSS variables a theme sets on the desktop root. */
export function themeVars(t: DesktopTheme): React.CSSProperties {
  const p = t.palette;
  const vars: Record<string, string> = {
    "--color-dx-bg": p.bg,
    "--color-dx-panel": p.panel,
    "--color-dx-raise": p.raise,
    "--color-dx-line": p.line,
    "--color-dx-text": p.text,
    "--color-dx-dim": p.dim,
    "--color-dx-faint": p.faint,
    "--color-dx-cyan": p.cyan,
    "--color-dx-pink": p.pink,
    "--color-dx-violet": p.violet,
    "--color-dx-amber": p.amber,
    "--color-dx-green": p.green,
    "--color-dx-red": p.red,
    "--color-dx-primary": p[t.primary],
    // The app's own tokens, for reused components (sheets, insights…).
    "--color-bg": p.bg,
    "--color-surface": p.raise,
    "--color-text": p.text,
    "--color-text-dim": p.dim,
    "--color-accent": p[t.primary],
    "--glass": p.panel,
    "--glass-edge": p.line,
  };
  return vars as React.CSSProperties;
}

/** The chosen theme (remembered per browser) and a setter. */
export function useDesktopTheme() {
  const [theme, setThemeState] = useState(() => {
    const t = find(stored());
    applyPalette(t);
    return t;
  });
  const setTheme = useCallback((id: string) => {
    const t = find(id);
    applyPalette(t);
    try {
      localStorage.setItem(KEY, t.id);
    } catch {
      /* private mode: just this visit */
    }
    setThemeState(t);
  }, []);
  const cycle = useCallback(() => {
    setThemeState((cur) => {
      const next = DESKTOP_THEMES[(DESKTOP_THEMES.indexOf(cur) + 1) % DESKTOP_THEMES.length];
      applyPalette(next);
      try {
        localStorage.setItem(KEY, next.id);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return { theme, setTheme, cycle };
}
