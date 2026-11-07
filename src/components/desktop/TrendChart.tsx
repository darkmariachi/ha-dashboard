import { useState } from "react";
import { useNow } from "../../lib/useNow";

export interface TrendSeries {
  label: string;
  values: number[];
  color: string;
  /** Filled area under the line (the first series usually). */
  fill?: boolean;
}

/**
 * A line/area chart over the last `hours`, with hour ticks along the bottom,
 * the min/max on the side, and a hover crosshair that reads out every
 * series at that moment — the desktop's answer to the tiles' sparklines.
 * Series are evenly spaced buckets ending now (useEntityHistory's shape).
 */
export function TrendChart({
  series,
  hours,
  unit = "",
  decimals = 0,
  height = 140,
  floor,
  format,
}: {
  series: TrendSeries[];
  hours: number;
  unit?: string;
  decimals?: number;
  height?: number;
  /** Pin the bottom of the scale (e.g. 0 for power), instead of the data's min. */
  floor?: number;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const now = useNow(60_000).getTime();
  const usable = series.filter((s) => s.values.length >= 2);
  if (usable.length === 0) return <div className="animate-pulse rounded-2xl bg-chip" style={{ height }} />;

  const n = usable[0].values.length;
  const all = usable.flatMap((s) => s.values);
  const rawMin = floor ?? Math.min(...all);
  const rawMax = Math.max(...all);
  const pad = (rawMax - rawMin) * 0.12 || 1;
  const min = floor ?? rawMin - pad;
  const max = rawMax + pad;
  const w = 600;
  const h = height;
  const x = (i: number, len: number) => (i / (len - 1)) * w;
  const y = (v: number) => h - ((v - min) / (max - min)) * (h - 8) - 4;
  const fmt = format ?? ((v: number) => `${v.toFixed(decimals)}${unit}`);

  const start = now - hours * 3600_000;
  const tickEvery = hours <= 6 ? 1 : hours <= 24 ? 6 : 24;
  const ticks: { pos: number; label: string }[] = [];
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  for (let t = first.getTime() + 3600_000; t < now; t += 3600_000) {
    const d = new Date(t);
    if (d.getHours() % tickEvery !== 0) continue;
    ticks.push({
      pos: ((t - start) / (now - start)) * 100,
      label:
        tickEvery === 24
          ? d.toLocaleDateString(undefined, { weekday: "short" })
          : d.toLocaleTimeString(undefined, { hour: "numeric" }),
    });
  }

  const hoverTime = hover === null ? null : start + (hover / (n - 1)) * (now - start);

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(Math.round(f * (n - 1)));
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden>
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              x2={w}
              y1={h * f}
              y2={h * f}
              stroke="currentColor"
              className="text-text-dim"
              strokeOpacity={0.15}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {usable.map((s) => {
            const pts = s.values.map((v, i) => `${x(i, s.values.length).toFixed(1)} ${y(v).toFixed(1)}`).join(" L");
            return (
              <g key={s.label}>
                {s.fill && <path d={`M${pts} L${w} ${h} L0 ${h}Z`} fill={s.color} opacity={0.16} />}
                <path
                  d={`M${pts}`}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
          {hover !== null && (
            <line
              x1={x(hover, n)}
              x2={x(hover, n)}
              y1={0}
              y2={h}
              stroke="currentColor"
              className="text-text"
              strokeOpacity={0.35}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        <div className="pointer-events-none absolute right-1 top-0 text-[10px] tabular-nums text-text-dim">{fmt(rawMax)}</div>
        <div className="pointer-events-none absolute bottom-0 right-1 text-[10px] tabular-nums text-text-dim">
          {fmt(floor ?? rawMin)}
        </div>

        {hover !== null && hoverTime !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-xl border border-border bg-surface px-2.5 py-1.5 text-[11px] shadow-lg"
            style={{ left: `${Math.min(88, Math.max(12, (hover / (n - 1)) * 100))}%` }}
          >
            <div className="font-semibold text-text-dim">
              {new Date(hoverTime).toLocaleString(undefined, {
                weekday: hours > 24 ? "short" : undefined,
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
            {usable.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5 tabular-nums text-text">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label} <b className="ml-auto pl-2 font-semibold">{fmt(s.values[Math.min(hover, s.values.length - 1)])}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative h-4 text-[10.5px] text-text-dim">
        {ticks.map((t) => (
          <span key={t.pos} className="absolute -translate-x-1/2" style={{ left: `${t.pos}%` }}>
            {t.label}
          </span>
        ))}
      </div>

      {usable.length > 1 && (
        <div className="flex gap-4 text-xs text-text-dim">
          {usable.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
