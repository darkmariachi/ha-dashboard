import { useId, useState } from "react";
import { useNow } from "../../lib/useNow";
import { C } from "./ui";

export interface Series {
  label: string;
  values: number[];
  color: string;
  /** Gradient area under the line. */
  fill?: boolean;
}

function timeTicks(start: number, end: number, hours: number) {
  const every = hours <= 6 ? 1 : hours <= 24 ? 3 : 24;
  const ticks: { pos: number; label: string }[] = [];
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  for (let t = first.getTime() + 3600_000; t < end; t += 3600_000) {
    const d = new Date(t);
    if (d.getHours() % every !== 0) continue;
    ticks.push({
      pos: (t - start) / (end - start),
      label:
        every === 24
          ? d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()
          : d.toLocaleTimeString(undefined, { hour: "numeric" }).replace(" ", "").toLowerCase(),
    });
  }
  return ticks;
}

/**
 * Neon line chart over the last `hours` (evenly spaced buckets ending now),
 * with a faint grid, y-axis values, hour ticks and a hover crosshair that
 * reads out every series.
 */
export function LineChart({
  series,
  hours,
  height = 180,
  floor,
  format = (v) => v.toFixed(0),
}: {
  series: Series[];
  hours: number;
  height?: number;
  floor?: number;
  format?: (v: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const now = useNow(60_000).getTime();
  const usable = series.filter((s) => s.values.length >= 2);
  if (usable.length === 0) {
    return <div className="animate-pulse rounded-md bg-white/[0.03]" style={{ height: height + 18 }} />;
  }

  const n = usable[0].values.length;
  const all = usable.flatMap((s) => s.values);
  const lo = floor ?? Math.min(...all);
  const hiRaw = Math.max(...all);
  const pad = (hiRaw - lo) * 0.12 || 1;
  const min = floor ?? lo - pad;
  const max = hiRaw + pad;
  const W = 1000;
  const H = height;
  const x = (i: number, len: number) => (i / (len - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * (H - 6) - 3;
  const start = now - hours * 3600_000;
  const ticks = timeTicks(start, now, hours);
  const gridVals = [0.25, 0.5, 0.75].map((f) => min + (max - min) * (1 - f));

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (n - 1)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }} aria-hidden>
          <defs>
            {usable.map((s, i) => (
              <linearGradient key={i} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} style={{ stroke: "rgb(var(--dx-ink))" }} strokeOpacity={0.05} strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          ))}
          {ticks.map((t) => (
            <line key={t.pos} x1={t.pos * W} x2={t.pos * W} y1={0} y2={H} style={{ stroke: "rgb(var(--dx-ink))" }} strokeOpacity={0.035} vectorEffect="non-scaling-stroke" />
          ))}
          {usable.map((s, i) => {
            const pts = s.values.map((v, j) => `${x(j, s.values.length).toFixed(1)} ${y(v).toFixed(1)}`).join(" L");
            return (
              <g key={s.label}>
                {s.fill && <path d={`M${pts} L${W} ${H} L0 ${H}Z`} fill={`url(#${id}-${i})`} />}
                <path
                  d={`M${pts}`}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ filter: `drop-shadow(0 0 4px ${s.color})` }}
                />
              </g>
            );
          })}
          {hover !== null && (
            <line x1={x(hover, n)} x2={x(hover, n)} y1={0} y2={H} style={{ stroke: "rgb(var(--dx-ink))" }} strokeOpacity={0.4} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {gridVals.map((v, i) => (
          <span key={i} className="dx-num pointer-events-none absolute left-1 -translate-y-1/2 text-[9.5px] text-dx-faint" style={{ top: `${(i + 1) * 25}%` }}>
            {format(v)}
          </span>
        ))}

        {hover !== null && (
          <>
            {usable.map((s) => (
              <span
                key={s.label}
                className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white"
                style={{
                  left: `${(hover / (n - 1)) * 100}%`,
                  top: y(s.values[Math.min(hover, s.values.length - 1)]),
                  background: s.color,
                  boxShadow: `0 0 8px ${s.color}`,
                }}
              />
            ))}
            <div
              className="pointer-events-none absolute top-1 z-10 min-w-[130px] -translate-x-1/2 rounded-md border border-white/10 bg-dx-raise/95 px-2.5 py-1.5 text-[11px] shadow-xl"
              style={{ left: `${Math.min(90, Math.max(10, (hover / (n - 1)) * 100))}%` }}
            >
              <div className="dx-num mb-0.5 text-dx-dim">
                {new Date(start + (hover / (n - 1)) * (now - start)).toLocaleString(undefined, {
                  weekday: hours > 24 ? "short" : undefined,
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              {usable.map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-dx-dim">{s.label}</span>
                  <b className="dx-num ml-auto font-medium text-dx-text">{format(s.values[Math.min(hover, s.values.length - 1)])}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="relative h-3">
        {ticks.map((t) => (
          <span key={t.pos} className="dx-num absolute -translate-x-1/2 text-[9.5px] text-dx-faint" style={{ left: `${t.pos * 100}%` }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Vertical bars with a neon gradient; label under each, value on hover. */
export function BarChart({
  bars,
  height = 120,
  from = C.violet,
  to = C.pink,
  format = (v) => v.toFixed(0),
  highlight,
  baseline = 0,
}: {
  bars: { label: string; value: number; sub?: string }[];
  /** Value at the bottom of the bars (e.g. a few degrees under the coldest
   * hour), so small differences show. */
  baseline?: number;
  height?: number;
  from?: string;
  to?: string;
  format?: (v: number) => string;
  /** Index drawn in cyan (e.g. today / now). */
  highlight?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(baseline + 1, ...bars.map((b) => b.value)) - baseline;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex items-end gap-[3px]" style={{ height }}>
        {bars.map((b, i) => {
          const h = Math.max(2, ((b.value - baseline) / max) * (height - 16));
          const hot = i === highlight;
          return (
            <div
              key={i}
              className="group relative flex h-full flex-1 flex-col justify-end"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            >
              {hover === i && (
                <div className="dx-num pointer-events-none absolute -top-0.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-dx-raise px-1.5 py-0.5 text-[10px] text-dx-text">
                  {format(b.value)}
                  {b.sub && <span className="ml-1 text-dx-dim">{b.sub}</span>}
                </div>
              )}
              <div
                className="w-full rounded-t-[2px] transition-[height] duration-700"
                style={{
                  height: h,
                  background: hot ? `linear-gradient(0deg, ${C.cyan}55, ${C.cyan})` : `linear-gradient(0deg, ${from}, ${to})`,
                  opacity: hover === null || hover === i ? 1 : 0.55,
                  boxShadow: `0 0 10px -2px ${hot ? C.cyan : to}`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px]">
        {bars.map((b, i) => (
          <span key={i} className="dx-num flex-1 truncate text-center text-[9.5px] text-dx-faint">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Gantt rows: when each thing was "on" across a time window. */
export function Timeline({
  rows,
  start,
  end,
  hours,
}: {
  rows: { label: string; spans: { start: number; end: number }[]; color: string; right?: React.ReactNode }[];
  start: number;
  end: number;
  hours: number;
}) {
  const span = end - start;
  const ticks = timeTicks(start, end, hours);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-[150px] shrink-0 truncate text-[11.5px] text-dx-dim">{r.label}</span>
          <div className="relative h-[14px] flex-1 overflow-hidden rounded-sm bg-white/[0.03]">
            {ticks.map((t) => (
              <span key={t.pos} className="absolute inset-y-0 w-px bg-white/[0.05]" style={{ left: `${t.pos * 100}%` }} />
            ))}
            {r.spans.map((s) => {
              const l = Math.max(0, (s.start - start) / span);
              const w = Math.max(0.003, (Math.min(end, s.end) - Math.max(start, s.start)) / span);
              return (
                <span
                  key={s.start}
                  title={`${new Date(s.start).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} – ${new Date(s.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
                  className="absolute inset-y-[2px] rounded-[2px]"
                  style={{ left: `${l * 100}%`, width: `${w * 100}%`, background: r.color, boxShadow: `0 0 8px ${r.color}` }}
                />
              );
            })}
          </div>
          {r.right !== undefined && <span className="dx-num w-[64px] shrink-0 text-right text-[11px] text-dx-dim">{r.right}</span>}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <span className="w-[150px] shrink-0" />
        <div className="relative h-3 flex-1">
          {ticks.map((t) => (
            <span key={t.pos} className="dx-num absolute -translate-x-1/2 text-[9.5px] text-dx-faint" style={{ left: `${t.pos * 100}%` }}>
              {t.label}
            </span>
          ))}
        </div>
        {rows.some((r) => r.right !== undefined) && <span className="w-[64px] shrink-0" />}
      </div>
    </div>
  );
}

/** Tiny inline sparkline for KPI cards. */
export function Spark({ values, color, height = 34 }: { values: number[] | null; color: string; height?: number }) {
  const id = useId().replace(/:/g, "");
  if (!values || values.length < 2) return <div style={{ height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const r = max - min || 1;
  const W = 200;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)} ${(height - 2 - ((v - min) / r) * (height - 4)).toFixed(1)}`).join(" L");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.4} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`M${pts} L${W} ${height} L0 ${height}Z`} fill={`url(#${id})`} />
      <path d={`M${pts}`} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </svg>
  );
}

/** Stacked vertical bars: each bar is the sum of its parts, drawn bottom-up
 * in `colors` order; hover shows the parts. */
export function StackedBars({
  bars,
  colors,
  names,
  height = 120,
  format = (v) => v.toFixed(0),
}: {
  bars: { label: string; parts: number[] }[];
  colors: string[];
  names: string[];
  height?: number;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.parts.reduce((a, c) => a + c, 0)));
  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex items-end gap-1.5" style={{ height }}>
        {bars.map((b, i) => {
          const total = b.parts.reduce((a, c) => a + c, 0);
          return (
            <div key={i} className="relative flex h-full flex-1 flex-col justify-end" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-dx-raise px-2 py-1 text-[10.5px]">
                  <div className="dx-num text-dx-text">{format(total)}</div>
                  {b.parts.map((p, j) => (
                    <div key={j} className="flex items-center gap-1.5 text-dx-dim">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors[j] }} />
                      {names[j]} <span className="dx-num ml-auto pl-2 text-dx-text">{format(p)}</span>
                    </div>
                  ))}
                </div>
              )}
              <span className="dx-num mb-0.5 text-center text-[9.5px] text-dx-faint">{total > 0 ? format(total) : ""}</span>
              <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-[2px]" style={{ opacity: hover === null || hover === i ? 1 : 0.55 }}>
                {b.parts.map((p, j) => (
                  <div
                    key={j}
                    className="w-full transition-[height] duration-700"
                    style={{ height: (p / max) * (height - 18), background: colors[j], boxShadow: `0 0 10px -3px ${colors[j]}` }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {bars.map((b, i) => (
          <span key={i} className="dx-num flex-1 truncate text-center text-[9.5px] text-dx-faint">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
