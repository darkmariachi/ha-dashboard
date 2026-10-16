import { useState } from "react";
import clsx from "clsx";
import { Lightbulb } from "lucide-react";
import { INSIGHT_LIGHTS, INSIGHTS_REFRESH_MS } from "../../config/insights";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { useStateHistory } from "../home/useStateHistory";
import { DAYS, WeekChart, dayStarts, hm } from "../devices/screenTime";
import { minutesPerDay } from "./history";

const AMBER = "#f2a516";
const TINT = "#fbe6bd";
/** Rows shown before "Show all". */
const COLLAPSED_ROWS = 6;

/** Seven tiny bars, one per day, scaled to the row's own busiest day. */
function MiniWeek({ days }: { days: number[] }) {
  const max = Math.max(30, ...days);
  return (
    <div className="flex h-6 w-[70px] shrink-0 items-end gap-[3px]">
      {days.map((m, i) => (
        <div
          key={i}
          className={clsx("flex-1 rounded-[2px]", i < days.length - 1 && "opacity-60")}
          style={{
            height: m > 0 ? `${Math.max(8, (m / max) * 100)}%` : "2px",
            background: m > 0 ? AMBER : "color-mix(in srgb, var(--color-text-dim) 30%, transparent)",
          }}
        />
      ))}
    </div>
  );
}

/** How long each light has been on today and over the last 7 days, from
 * HA's recorder history — busiest first. */
export function LightsInsightCard({ index = 0 }: { index?: number }) {
  const { entities } = useHa();
  const now = useNow(60_000);
  const [showAll, setShowAll] = useState(false);
  const lights = INSIGHT_LIGHTS.filter((l) => entities[l.entityId]);
  const history = useStateHistory(
    lights.map((l) => l.entityId),
    DAYS * 24,
    { refreshMs: INSIGHTS_REFRESH_MS },
  );
  if (lights.length === 0) return null;

  const starts = dayStarts(now);
  const rows = history
    ? lights
        .map((l) => {
          const days = minutesPerDay(history[l.entityId] ?? [], "on", starts, now.getTime());
          return { ...l, days, week: days.reduce((a, b) => a + b, 0), on: entities[l.entityId]?.state === "on" };
        })
        .sort((a, b) => b.days[DAYS - 1] - a.days[DAYS - 1] || b.week - a.week)
    : null;
  const totals = rows ? starts.map((_, i) => rows.reduce((sum, r) => sum + r.days[i], 0)) : null;
  const onNow = lights.filter((l) => entities[l.entityId]?.state === "on").length;
  const used = rows?.filter((r) => r.week > 0) ?? [];
  const unused = (rows?.length ?? 0) - used.length;
  const visible = showAll ? used : used.slice(0, COLLAPSED_ROWS);

  return (
    <div
      className="glass rise flex flex-col gap-4 rounded-[26px] p-5"
      style={{ background: `color-mix(in srgb, ${TINT} var(--tint-strength), var(--glass))`, animationDelay: `${100 + index * 70}ms` }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: "var(--chip-off)", color: AMBER }}
        >
          <Lightbulb size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[19px] font-semibold tracking-[-0.3px] text-text">Lights</div>
          <div className="truncate text-[13px] text-text-dim">
            {totals ? `${hm(totals[DAYS - 1])} of light-time today` : "Adding up the hours…"}
            {` · ${onNow} on now`}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">
          All lights, last 7 days
        </span>
        {totals ? (
          <WeekChart series={[{ color: AMBER, days: totals }]} starts={starts} />
        ) : (
          <div className="h-28 animate-pulse rounded-2xl bg-chip" />
        )}
      </div>

      {rows && (
        <div className="flex flex-col gap-1 border-t border-text-dim/15 pt-3">
          <div className="flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">
            <span>Light</span>
            <span>Today · 7 days</span>
          </div>
          {visible.map((r) => (
            <div key={r.entityId} className="flex items-center gap-3 rounded-2xl px-1 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-[15px] font-medium text-text">
                  {r.on && <span className="live-dot h-2 w-2 shrink-0 rounded-full" style={{ background: AMBER }} />}
                  {r.room}
                </div>
                <div className="truncate text-xs text-text-dim">{r.label}</div>
              </div>
              <MiniWeek days={r.days} />
              <div className="w-[76px] shrink-0 text-right leading-tight">
                <div className="text-[15px] font-semibold tabular-nums text-text">{hm(r.days[DAYS - 1])}</div>
                <div className="text-xs tabular-nums text-text-dim">{hm(r.week)}</div>
              </div>
            </div>
          ))}
          {used.length > COLLAPSED_ROWS && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-1 rounded-full py-2 text-xs font-semibold text-text active:scale-95"
              style={{ background: "var(--chip-off)" }}
            >
              {showAll ? "Show fewer" : `Show all ${used.length}`}
            </button>
          )}
          {unused > 0 && (
            <p className="px-1 pt-1 text-xs text-text-dim">
              {unused} other {unused === 1 ? "light wasn't" : "lights weren't"} on this week.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
