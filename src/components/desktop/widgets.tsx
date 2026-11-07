import clsx from "clsx";
import type { HassEntity } from "home-assistant-js-websocket";
import type { LucideIcon } from "lucide-react";

export const ALERT = "#d9822b";
export const OK = "#2fae7e";
export const DANGER = "#d14d5b";

/** A reading as a number, or null while it's unavailable/unknown. */
export function num(e: HassEntity | undefined): number | null {
  if (!e) return null;
  const v = parseFloat(e.state);
  return Number.isFinite(v) ? v : null;
}

export function isLive(e: HassEntity | undefined) {
  return !!e && e.state !== "unavailable" && e.state !== "unknown";
}

/** "3 d 4 h", "2 h 10 min", "5 min". */
export function duration(ms: number) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${mins % 60} min`;
  return `${mins} min`;
}

/** A titled glass card. */
export function Panel({
  title,
  icon: Icon,
  color,
  right,
  className,
  delay = 0,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  color?: string;
  right?: React.ReactNode;
  className?: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={clsx("glass rise flex min-w-0 flex-col gap-3 rounded-[26px] p-5", className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2">
        {Icon && <Icon size={17} style={{ color }} className={color ? undefined : "text-text-dim"} />}
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** One headline number in the Overview's KPI strip; opens its detail on click. */
export function KpiTile({
  icon: Icon,
  label,
  value,
  unit,
  detail,
  color,
  alert,
  footer,
  onOpen,
  delay = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  unit?: string;
  detail?: React.ReactNode;
  color: string;
  alert?: boolean;
  footer?: React.ReactNode;
  onOpen?: () => void;
  delay?: number;
}) {
  const accent = alert ? ALERT : color;
  return (
    <button
      onClick={onOpen}
      disabled={!onOpen}
      className={clsx(
        "glass rise flex min-h-[132px] min-w-0 flex-col gap-1.5 rounded-[22px] px-4 py-3.5 text-left",
        onOpen && "cursor-pointer transition-transform hover:-translate-y-0.5 active:scale-[0.98]",
      )}
      style={{
        animationDelay: `${delay}ms`,
        ...(alert && {
          borderColor: `${ALERT}8c`,
          boxShadow: `var(--glass-shadow), 0 0 0 1px ${ALERT}4d, 0 0 28px -6px ${ALERT}8c`,
        }),
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-[9px]"
          style={{ background: `${accent}26`, color: accent }}
        >
          <Icon size={15} />
        </span>
        <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-dim">{label}</span>
      </div>
      <div
        className="truncate text-[30px] font-light leading-none tracking-[-1px] text-text tabular-nums"
        style={alert ? { color: ALERT, fontWeight: 500 } : undefined}
      >
        {value}
        {unit && <small className="ml-1 text-[13px] font-medium tracking-normal text-text-dim">{unit}</small>}
      </div>
      {detail && <div className="truncate text-[12px] text-text-dim">{detail}</div>}
      {footer && <div className="mt-auto w-full">{footer}</div>}
    </button>
  );
}

/** Label on the left, value on the right, with an optional status dot. */
export function Row({
  label,
  value,
  sub,
  dot,
  strong,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  dot?: string;
  strong?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border py-2 text-[13px] last:border-0">
      {dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-text">{label}</div>
        {sub && <div className="truncate text-[11.5px] text-text-dim">{sub}</div>}
      </div>
      <div className="shrink-0 text-right tabular-nums text-text-dim" style={strong ? { color: strong, fontWeight: 600 } : undefined}>
        {value}
      </div>
    </div>
  );
}

/** Horizontal usage bar (0–100), amber past 80 and red past 92. */
export function Meter({ label, value, invertWarn }: { label: string; value: number | null; invertWarn?: boolean }) {
  const v = value === null ? null : Math.min(100, Math.max(0, value));
  const bad = v !== null && (invertWarn ? v <= 20 : v >= 92);
  const warn = v !== null && (invertWarn ? v <= 35 : v >= 80);
  const color = bad ? DANGER : warn ? ALERT : "#4f79c9";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-text-dim">{label}</span>
        <span className="font-semibold tabular-nums text-text">{v === null ? "—" : `${Math.round(v)}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-text-dim/20">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${v ?? 0}%`, background: color }} />
      </div>
    </div>
  );
}
