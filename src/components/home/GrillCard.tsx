import { AlertTriangle, Fan, Flame, Minus, Plus, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { GRILL } from "../../config/grill";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";

const ACCENT = "#e0682b";
const TINT = "#fde3d3";
const PROBE_COLORS = ["#c0392b", "#7b5cd6", "#1f9d8b"];
const TARGET_COLOR = "#9a8f80";
const SEND_DELAY_MS = 1200;
const HISTORY_REFRESH_MS = 60_000;

const num = (s: string | undefined) => {
  const v = parseFloat(s ?? "");
  return Number.isFinite(v) ? v : undefined;
};

function duration(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

/**
 * A number the user nudges with +/- buttons: shows the pending value right
 * away and sends one service call once they stop tapping, so five quick
 * taps make one cloud write instead of five.
 */
export function useNudgedValue(current: number | undefined, send: (v: number) => void) {
  const [pending, setPending] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Drop the pending value once HA reports it back.
  useEffect(() => {
    if (pending !== null && current === pending) setPending(null);
  }, [current, pending]);

  function nudge(next: number) {
    navigator.vibrate?.(8);
    setPending(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send(next), SEND_DELAY_MS);
  }
  return { value: pending ?? current, pending: pending !== null, nudge };
}

function Stepper({
  value,
  pending,
  min,
  max,
  step,
  onChange,
  size = "sm",
}: {
  value: number | undefined;
  pending: boolean;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  size?: "sm" | "lg";
}) {
  const btn = clsx(
    "flex shrink-0 items-center justify-center rounded-full text-text active:scale-90 disabled:opacity-30",
    size === "lg" ? "h-11 w-11" : "h-8 w-8",
  );
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="flex items-center gap-2">
      <button
        className={btn}
        style={{ background: "var(--chip-off)" }}
        disabled={value === undefined || value <= min}
        onClick={() => value !== undefined && onChange(clamp(value - step))}
        aria-label="Lower"
      >
        <Minus size={size === "lg" ? 18 : 14} />
      </button>
      <span
        className={clsx(
          "min-w-[3.2em] text-center font-semibold tabular-nums transition-opacity",
          size === "lg" ? "text-xl" : "text-sm",
          pending && "opacity-60",
        )}
      >
        {value === undefined ? "—" : `${Math.round(value)}°`}
      </span>
      <button
        className={btn}
        style={{ background: "var(--chip-off)" }}
        disabled={value === undefined || value >= max}
        onClick={() => value !== undefined && onChange(clamp(value + step))}
        aria-label="Raise"
      >
        <Plus size={size === "lg" ? 18 : 14} />
      </button>
    </div>
  );
}

type Series = { id: string; color: string; dashed?: boolean; points: { t: number; v: number }[] };
type CompressedState = { s: string; lu: number };

/** Grill, target and plugged-in probe temperatures since the cook began. */
function useCookHistory(start: number | undefined, ids: string[]) {
  const { status, sendMessage } = useHa();
  const [data, setData] = useState<Record<string, { t: number; v: number }[]>>({});
  const key = ids.join(",");

  useEffect(() => {
    if (status !== "connected" || !start) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await sendMessage<Record<string, CompressedState[]>>({
          type: "history/history_during_period",
          start_time: new Date(start!).toISOString(),
          entity_ids: key.split(","),
          minimal_response: true,
          no_attributes: true,
          significant_changes_only: false,
        });
        const out: Record<string, { t: number; v: number }[]> = {};
        for (const [id, pts] of Object.entries(res)) {
          out[id] = pts.map((p) => ({ t: p.lu * 1000, v: parseFloat(p.s) })).filter((p) => Number.isFinite(p.v));
        }
        if (!cancelled) setData(out);
      } catch {
        /* keep the last chart */
      }
    }
    load();
    const t = setInterval(load, HISTORY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [status, sendMessage, start, key]);

  return data;
}

export function CookChart({
  series,
  start,
  end,
  labelClassName = "text-text-dim",
  gridColor = "rgba(127,127,127,0.22)",
}: {
  series: Series[];
  start: number;
  end: number;
  labelClassName?: string;
  gridColor?: string;
}) {
  const all = series.flatMap((s) => s.points.map((p) => p.v));
  if (all.length < 2 || end - start < 60_000) return null;
  const lo = Math.floor(Math.min(...all) / 25) * 25;
  const hi = Math.ceil(Math.max(...all) / 25) * 25 || lo + 25;
  const w = 600;
  const h = 150;
  const x = (t: number) => ((t - start) / (end - start)) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * h;
  const gridStep = hi - lo > 200 ? 100 : 50;
  const grid: number[] = [];
  for (let g = Math.ceil(lo / gridStep) * gridStep; g <= hi; g += gridStep) grid.push(g);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-36 w-full overflow-visible" aria-hidden>
        {grid.map((g) => (
          <line key={g} x1={0} x2={w} y1={y(g)} y2={y(g)} stroke={gridColor} vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => {
          if (s.points.length === 0) return null;
          // Step line held to "now", since HA only records changes.
          let d = "";
          s.points.forEach((p, i) => {
            const px = x(Math.max(p.t, start)).toFixed(1);
            const py = y(p.v).toFixed(1);
            d += i === 0 ? `M${px} ${py}` : ` H${px} V${py}`;
          });
          d += ` H${w}`;
          return (
            <path
              key={s.id}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 1.5 : 2.25}
              strokeDasharray={s.dashed ? "5 5" : undefined}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {grid.map((g) => (
        <span
          key={g}
          className={clsx("pointer-events-none absolute left-0 -translate-y-1/2 text-[10px] tabular-nums", labelClassName)}
          style={{ top: `${(y(g) / h) * 100}%` }}
        >
          {g}°
        </span>
      ))}
    </div>
  );
}

/** Everything a grill view needs: live state, nudgeable targets, the
 * cook history, and a one-line status. Shared by the home/phone card and
 * the desktop panel. */
export function useGrill({ pitColor = ACCENT, targetColor = TARGET_COLOR, probeColors = PROBE_COLORS }: { pitColor?: string; targetColor?: string; probeColors?: string[] } = {}) {
  const { entities, callService } = useHa();
  const now = useNow(30_000);

  const e = (id: string) => entities[id];
  const powerOn = e(GRILL.power)?.state === "on";
  const stale = e(GRILL.stale)?.state === "on";
  const armed = e(GRILL.hold.armed)?.state === "on";
  const cookStartIso = e(GRILL.cookStart)?.state;
  const cookStart = cookStartIso && !Number.isNaN(Date.parse(cookStartIso)) ? Date.parse(cookStartIso) : undefined;

  const pit = num(e(GRILL.grillTemp)?.state);
  const targetEnt = e(GRILL.target);
  const target = useNudgedValue(num(targetEnt?.state), (v) =>
    callService("number", "set_value", { value: v }, { entity_id: GRILL.target }).catch(() => {}),
  );
  const doneEnt = e(GRILL.hold.doneTemp);
  const holdEnt = e(GRILL.hold.holdTemp);
  const setInput = (id: string) => (v: number) =>
    callService("input_number", "set_value", { value: v }, { entity_id: id }).catch(() => {});
  const done = useNudgedValue(num(doneEnt?.state), setInput(GRILL.hold.doneTemp));
  const hold = useNudgedValue(num(holdEnt?.state), setInput(GRILL.hold.holdTemp));

  const probes = GRILL.probes
    .map((p, i) => ({ name: p.name, tempId: p.temp, color: probeColors[i], temp: num(e(p.temp)?.state), target: num(e(p.target)?.state) }))
    .filter((p) => p.temp !== undefined);

  const chartIds = [GRILL.grillTemp, GRILL.target, ...probes.map((p) => p.tempId)];
  const history = useCookHistory(powerOn ? cookStart : undefined, chartIds);

  const visible = !!targetEnt && (powerOn || stale || armed);

  const fan = num(e(GRILL.fan)?.state);
  const lidOpen = e(GRILL.lid)?.state === "off";
  const problem = e(GRILL.problem)?.state === "on";
  const atTemp = e(GRILL.atTemp)?.state === "on";
  const hottestProbe = probes.reduce<number | undefined>((m, p) => (m === undefined || p.temp! > m ? p.temp : m), undefined);

  const status = stale
    ? "Lost contact — check the grill in person"
    : !powerOn
      ? "Off"
      : atTemp
        ? `Holding at ${Math.round(num(targetEnt?.state) ?? 0)}°`
        : pit !== undefined && target.value !== undefined && pit < target.value
          ? `Heating to ${Math.round(target.value)}°`
          : `Cooling to ${Math.round(target.value ?? 0)}°`;

  const series: Series[] = [
    { id: GRILL.target, color: targetColor, dashed: true, points: history[GRILL.target] ?? [] },
    { id: GRILL.grillTemp, color: pitColor, points: history[GRILL.grillTemp] ?? [] },
    ...probes.map((p) => ({ id: p.tempId, color: p.color, points: history[p.tempId] ?? [] })),
  ];

  const pitMin = (targetEnt?.attributes.min as number | undefined) ?? 150;
  const pitMax = (targetEnt?.attributes.max as number | undefined) ?? 700;
  const holdReady = !!doneEnt && !!holdEnt;

  return { visible, now, e, powerOn, stale, armed, cookStart, pit, target, done, hold, probes, fan, lidOpen, problem, atTemp, hottestProbe, status, series, pitMin, pitMax, holdReady, callService };
}

/**
 * The Kamado Joe during a cook: pit temperature against its target (with
 * +/- to change it), each plugged-in meat probe, a chart of the cook so far,
 * and the auto-hold that drops the pit to a holding temperature once the
 * meat is done — for overnight smokes. Hidden while the grill is off.
 */
export function GrillCard({ index = 0 }: { index?: number }) {
  const g = useGrill();
  const { visible, now, e, powerOn, stale, armed, cookStart, pit, target, done, hold, probes, fan, lidOpen, problem, hottestProbe, status, series, pitMin, pitMax, holdReady, callService } = g;
  if (!visible) return null;

  return (
    <div
      className="glass rise flex flex-col gap-4 rounded-[26px] p-5"
      style={{ background: `color-mix(in srgb, ${TINT} var(--tint-strength), var(--glass))`, animationDelay: `${300 + index * 50}ms` }}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: "var(--chip-off)", color: ACCENT }}>
          <Flame size={22} className={clsx(powerOn && !stale && "animate-pulse")} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[19px] font-semibold tracking-[-0.3px] text-text">{GRILL.name}</div>
          <div className={clsx("truncate text-[13px]", stale ? "font-semibold text-warn" : "text-text-dim")}>{status}</div>
        </div>
        {cookStart && powerOn && (
          <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-text-dim">
            <Timer size={13} /> {duration(now.getTime() - cookStart)}
          </span>
        )}
      </div>

      {(stale || problem || lidOpen) && (
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold" style={{ background: "#fff1d6", color: "#8a5a00" }}>
          <AlertTriangle size={14} className="shrink-0" />
          {stale
            ? "No update from the grill for over 5 minutes. It may still be burning."
            : problem
              ? `Grill error: ${(e(GRILL.error)?.attributes.codes as unknown[] | undefined)?.join(", ") || e(GRILL.error)?.state}`
              : "Lid open"}
        </div>
      )}

      {/* Pit temp + target */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Pit</div>
          <div className="text-[52px] font-light leading-none tracking-[-2px] text-text tabular-nums" style={{ color: stale ? undefined : ACCENT }}>
            {pit === undefined ? "—" : Math.round(pit)}°
          </div>
          {fan !== undefined && (
            <div className="mt-1 flex items-center gap-1 text-xs text-text-dim">
              <Fan size={12} className={clsx(fan > 0 && "animate-spin [animation-duration:2s]")} /> Fan {Math.round(fan)}%
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Target</div>
          <Stepper
            size="lg"
            value={target.value}
            pending={target.pending}
            min={pitMin}
            max={pitMax}
            step={5}
            onChange={target.nudge}
          />
        </div>
      </div>

      {/* Probes */}
      {probes.length > 0 ? (
        <div className="flex flex-col gap-2">
          {probes.map((p) => {
            const goal = done.value ?? p.target;
            const pct = goal ? Math.min(100, Math.max(0, ((p.temp! - 40) / (goal - 40)) * 100)) : 0;
            return (
              <div key={p.name} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-text">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                    {p.name}
                  </span>
                  <span className="tabular-nums text-text">
                    <b className="text-base">{Math.round(p.temp!)}°</b>
                    {goal !== undefined && <span className="text-text-dim"> / {Math.round(goal)}°</span>}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--chip-off)" }}>
                  <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: p.color }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        powerOn && <div className="text-xs text-text-dim">No meat probe plugged in.</div>
      )}

      {cookStart && <CookChart series={series} start={cookStart} end={now.getTime()} />}

      {/* Auto hold */}
      {holdReady && (
        <div className="flex flex-col gap-3 rounded-2xl p-3" style={{ background: "var(--chip-off)" }}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text">Auto hold</div>
              <div className="text-xs text-text-dim">
                {armed
                  ? `When meat hits ${Math.round(done.value ?? 0)}°, drop the pit to ${Math.round(hold.value ?? 0)}°`
                  : hottestProbe !== undefined && done.value !== undefined && hottestProbe >= done.value
                    ? "Done — holding"
                    : "Off"}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={armed}
              onClick={() => {
                navigator.vibrate?.(10);
                callService("input_boolean", armed ? "turn_off" : "turn_on", {}, { entity_id: GRILL.hold.armed }).catch(() => {});
              }}
              className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
              style={{ background: armed ? ACCENT : "rgba(127,127,127,0.35)" }}
            >
              <span className={clsx("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all", armed ? "left-[22px]" : "left-0.5")} />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-dim">
            <span>Meat done at</span>
            <Stepper value={done.value} pending={done.pending} min={100} max={250} step={1} onChange={done.nudge} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-dim">
            <span>Then hold pit at</span>
            <Stepper value={hold.value} pending={hold.pending} min={150} max={250} step={5} onChange={hold.nudge} />
          </div>
        </div>
      )}
    </div>
  );
}
