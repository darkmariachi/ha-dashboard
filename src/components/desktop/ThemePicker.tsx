import { Check, X } from "lucide-react";
import { useEffect } from "react";
import { DESKTOP_THEMES, type DesktopTheme } from "./themes";

/** Fonts per theme, for the preview cards (the real ones live in themes.css). */
const PREVIEW_FONT: Record<string, { title: string; body: string; num: string; upper: boolean }> = {
  neon: { title: "Space Grotesk Variable", body: "Space Grotesk Variable", num: "JetBrains Mono Variable", upper: true },
  netrunner: { title: "Rajdhani", body: "Rajdhani", num: "Share Tech Mono", upper: true },
  vice: { title: "Pacifico", body: "Outfit Variable", num: "JetBrains Mono Variable", upper: false },
  tactical: { title: "Bebas Neue", body: "Barlow", num: "Barlow Condensed", upper: true },
  hextech: { title: "Cinzel Variable", body: "Barlow", num: "Barlow", upper: true },
  ocarina: { title: "Uncial Antiqua", body: "Nunito Variable", num: "Nunito Variable", upper: false },
  frost: { title: "Josefin Sans Variable", body: "Josefin Sans Variable", num: "Josefin Sans Variable", upper: true },
};

function Preview({ t }: { t: DesktopTheme }) {
  const p = t.palette;
  const f = PREVIEW_FONT[t.id];
  const primary = p[t.primary];
  const bars = [p.cyan, p.pink, p.violet, p.amber, p.green, p.red];
  const shape = {
    neon: { radius: 8, clip: undefined },
    netrunner: { radius: 0, clip: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))" },
    vice: { radius: 14, clip: undefined },
    tactical: { radius: 0, clip: undefined },
    hextech: { radius: 0, clip: undefined },
    ocarina: { radius: 12, clip: undefined },
    frost: { radius: 0, clip: undefined },
  }[t.id] ?? { radius: 8, clip: undefined };
  const bg =
    t.id === "vice"
      ? "linear-gradient(180deg, #0d0620, #2a0b45 45%, #6a1257 75%, #f7854a)"
      : t.id === "hextech"
        ? `radial-gradient(260px 120px at 50% -20%, rgba(3,151,171,.35), transparent), ${p.bg}`
        : t.id === "ocarina"
          ? `radial-gradient(200px 120px at 30% 20%, rgba(111,211,255,.18), transparent), radial-gradient(260px 160px at 50% 110%, rgba(92,207,110,.2), transparent), ${p.bg}`
          : t.id === "frost"
            ? `linear-gradient(180deg, #16181c, ${p.bg} 60%, #23262b)`
            : t.id === "tactical"
          ? `linear-gradient(115deg, transparent 60%, rgba(255,70,85,.14) 60%, rgba(255,70,85,.14) 70%, transparent 70%), ${p.bg}`
          : p.bg;
  return (
    <div className="relative h-[150px] overflow-hidden p-3" style={{ background: bg }}>
      {t.id === "netrunner" && (
        <div className="pointer-events-none absolute inset-0" style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,.25) 0 1px, transparent 1px 3px)" }} />
      )}
      <div
        className="relative flex h-full flex-col gap-2 border p-3"
        style={{
          borderRadius: shape.radius,
          clipPath: shape.clip,
          background: t.id === "hextech" ? "linear-gradient(180deg,#0a1a30,#071121)" : p.panel,
          borderColor:
            t.id === "hextech" || t.id === "ocarina" ? "#a8892f" : t.id === "netrunner" ? "rgba(252,238,10,.35)" : t.id === "frost" ? "transparent" : p.line,
          borderTopColor: t.id === "frost" ? "rgba(230,226,215,.5)" : undefined,
          borderBottomColor: t.id === "frost" ? "rgba(230,226,215,.5)" : undefined,
          backdropFilter: t.id === "vice" ? "blur(6px)" : undefined,
          boxShadow: t.id === "vice" ? "0 0 22px -8px #ff3f9f" : undefined,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            style={{
              width: t.id === "hextech" ? 7 : 4,
              height: t.id === "hextech" ? 7 : 12,
              background: primary,
              transform: t.id === "hextech" ? "rotate(45deg)" : t.id === "tactical" ? "skewX(-18deg)" : undefined,
              borderRadius: t.id === "vice" ? 99 : 0,
              boxShadow: `0 0 8px ${primary}`,
            }}
          />
          <span
            style={{
              fontFamily: f.title,
              fontSize: t.id === "vice" ? 17 : t.id === "tactical" ? 19 : t.id === "ocarina" ? 16 : 13,
              letterSpacing: t.id === "frost" ? "0.3em" : f.upper ? "0.14em" : "0.02em",
              textTransform: f.upper ? "uppercase" : "none",
              color:
                t.id === "netrunner" || t.id === "ocarina" ? p.amber : t.id === "hextech" ? "#c8aa6e" : t.id === "vice" ? "#ff6fb5" : p.text,
              textShadow: t.id === "vice" ? "0 0 10px #ff3f9f" : t.id === "netrunner" ? "2px 0 rgba(255,42,109,.7), -2px 0 rgba(0,240,255,.5)" : undefined,
              fontWeight: t.id === "hextech" || t.id === "netrunner" ? 700 : t.id === "frost" ? 300 : 400,
            }}
          >
            {t.id === "vice" ? "Energy" : "Power"}
          </span>
        </div>
        <div className="flex items-baseline gap-1" style={{ fontFamily: f.num, color: p.text }}>
          <span style={{ fontSize: 26, fontWeight: 300 }}>2.41</span>
          <span style={{ fontSize: 11, color: p.dim }}>kW</span>
        </div>
        <div className="mt-auto flex items-end gap-1">
          {bars.map((c, i) => (
            <span
              key={c + i}
              style={{ width: 14, height: [18, 28, 12, 34, 22, 16][i], background: c, boxShadow: `0 0 6px ${c}88`, borderRadius: t.id === "vice" ? 3 : 0 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Picks the desktop theme; previews each one in its own colors and fonts. */
export function ThemePicker({ current, onPick, onClose }: { current: string; onPick: (id: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-label="Theme" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="dx-panel w-full max-w-[1100px] p-5" style={{ fontFamily: "Space Grotesk Variable, sans-serif" }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <div>
            <div className="text-[18px] font-semibold text-dx-text">Theme</div>
            <div className="text-[12px] text-dx-dim">Changes colors, fonts, panel shapes and the background. Press T anywhere to cycle.</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1.5 text-dx-dim hover:bg-white/5 hover:text-dx-text">
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {DESKTOP_THEMES.map((t) => {
            const on = t.id === current;
            const primary = t.palette[t.primary];
            return (
              <button
                key={t.id}
                onClick={() => onPick(t.id)}
                className="dx-theme-card overflow-hidden rounded-lg border text-left"
                style={{ borderColor: on ? primary : "rgba(255,255,255,0.1)", boxShadow: on ? `0 0 0 1px ${primary}, 0 0 22px -6px ${primary}` : undefined }}
              >
                <Preview t={t} />
                <div className="flex items-start gap-2 bg-black/40 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-white">{t.name}</div>
                    <div className="text-[10.5px] uppercase tracking-[0.1em]" style={{ color: primary }}>
                      {t.inspiredBy === "the original" ? "Original" : `Inspired by ${t.inspiredBy}`}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-white/55">{t.tagline}</div>
                  </div>
                  {on && (
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-black" style={{ background: primary }}>
                      <Check size={13} strokeWidth={3} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
