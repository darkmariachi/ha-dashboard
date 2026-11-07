import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/** The desktop palette, for SVG and inline styles (Tailwind has the same
 * values as dx-* utilities). */
export const C = {
  cyan: "#21e6f2",
  pink: "#ff2fa8",
  violet: "#a35bff",
  amber: "#ffb020",
  green: "#2ef2a3",
  red: "#ff4d6d",
  dim: "#7f84a0",
  faint: "#484c66",
  text: "#e9ebf7",
};

/** A titled console panel. `accent` colors the little tick before the title. */
export function Panel({
  title,
  icon: Icon,
  accent = C.cyan,
  right,
  className,
  bodyClassName,
  delay = 0,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  accent?: string;
  right?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={clsx("dx-panel dx-in flex min-w-0 flex-col", className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-dx-line px-4">
        <span className="h-3 w-[3px] rounded-full" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        {Icon && <Icon size={14} className="text-dx-dim" />}
        <h2 className="flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.16em] text-dx-dim">{title}</h2>
        {right}
      </header>
      <div className={clsx("min-h-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Small uppercase label. */
export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("text-[10px] font-semibold uppercase tracking-[0.14em] text-dx-dim", className)}>{children}</div>;
}

/** Big mono number with a unit. */
export function Big({
  value,
  unit,
  color,
  size = 38,
}: {
  value: React.ReactNode;
  unit?: string;
  color?: string;
  size?: number;
}) {
  return (
    <div className="dx-num flex items-baseline gap-1 leading-none" style={{ fontSize: size, color: color ?? C.text }}>
      <span className="font-light">{value}</span>
      {unit && <span className="text-[12px] font-medium text-dx-dim">{unit}</span>}
    </div>
  );
}

/** A compact on/off switch for mouse use. */
export function Switch({
  on,
  onChange,
  disabled,
  color = C.cyan,
  label,
}: {
  on: boolean;
  onChange: () => void;
  disabled?: boolean;
  color?: string;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onChange}
      className="relative h-[18px] w-[32px] shrink-0 cursor-pointer rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-35"
      style={{
        background: on ? `${color}33` : "rgba(255,255,255,0.05)",
        borderColor: on ? color : "rgba(255,255,255,0.12)",
        boxShadow: on ? `0 0 10px -2px ${color}` : undefined,
      }}
    >
      <span
        className="absolute top-[2px] h-3 w-3 rounded-full transition-all"
        style={{ left: on ? 16 : 2, background: on ? color : C.faint }}
      />
    </button>
  );
}

/** Row of mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | undefined;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-dx-line bg-white/[0.02] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex flex-1 items-center justify-center gap-1 rounded-[5px] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors",
            o.value === value ? "bg-dx-cyan/15 text-dx-cyan shadow-[inset_0_0_0_1px_rgba(33,230,242,0.4)]" : "text-dx-dim hover:text-dx-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Outlined console button. */
export function Btn({
  children,
  onClick,
  color,
  disabled,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  color?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-35",
        !color && "border-dx-line text-dx-dim hover:border-white/20 hover:text-dx-text",
        className,
      )}
      style={color ? { borderColor: `${color}66`, color, background: `${color}12` } : undefined}
    >
      {children}
    </button>
  );
}

/** Donut gauge, 0–100. */
export function Ring({
  value,
  label,
  sub,
  color = C.cyan,
  size = 86,
}: {
  value: number | null;
  label: string;
  sub?: string;
  color?: string;
  size?: number;
}) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx={50} cy={50} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={7} />
          {[...Array(24)].map((_, i) => (
            <line
              key={i}
              x1={50}
              y1={3}
              x2={50}
              y2={6}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1}
              transform={`rotate(${i * 15} 50 50)`}
            />
          ))}
          <circle
            cx={50}
            cy={50}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * circ} ${circ}`}
            style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: "stroke-dasharray 0.8s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="dx-num text-[19px] font-medium text-dx-text">{value === null ? "—" : Math.round(v)}</span>
          <span className="text-[9px] text-dx-dim">%</span>
        </div>
      </div>
      <div className="text-center leading-tight">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dx-dim">{label}</div>
        {sub && <div className="dx-num text-[10.5px] text-dx-faint">{sub}</div>}
      </div>
    </div>
  );
}

/** Label, a thin horizontal bar, and a value. */
export function HBar({
  label,
  value,
  max,
  display,
  color = C.pink,
  sub,
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  display: React.ReactNode;
  color?: string;
  sub?: React.ReactNode;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="truncate text-dx-text">{label}</span>
        <span className="dx-num shrink-0 text-dx-dim">
          <span className="text-dx-text">{display}</span>
          {sub && <span className="ml-1.5">{sub}</span>}
        </span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-sm bg-white/[0.05]">
        <div
          className="h-full rounded-sm transition-[width] duration-700"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}66, ${color})`, boxShadow: `0 0 8px ${color}88` }}
        />
      </div>
    </div>
  );
}

/** Status dot. */
export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />}
      <span className="relative h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
    </span>
  );
}

/** Two-column key/value line for dense lists. */
export function KV({ k, v, color, dot }: { k: React.ReactNode; v: React.ReactNode; color?: string; dot?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-dashed border-dx-line py-[7px] text-[12px] last:border-0">
      {dot && <Dot color={dot} />}
      <span className="min-w-0 flex-1 truncate text-dx-dim">{k}</span>
      <span className="dx-num shrink-0 text-right" style={{ color: color ?? C.text }}>
        {v}
      </span>
    </div>
  );
}
