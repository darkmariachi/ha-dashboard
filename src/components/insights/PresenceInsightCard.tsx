import clsx from "clsx";
import { House } from "lucide-react";
import { HOUSEHOLD_PEOPLE } from "../../config/curatedHome";
import { INSIGHTS_REFRESH_MS } from "../../config/insights";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { useStateHistory } from "../home/useStateHistory";
import { DAYS, dayStarts, hm } from "../devices/screenTime";
import { minutesPerDay, spansIn } from "./history";

const HOME_GREEN = "#2fbf78";
const TINT = "#cdf0dc";
const DAY_MS = 86400000;
const HOUR_TICKS = [
  [0, "12a"],
  [6, "6a"],
  [12, "12p"],
  [18, "6p"],
] as const;

/** One day as a 24-hour strip, filled where the person was home. */
function DayStrip({ spans, dayStart, now, today }: { spans: { start: number; end: number }[]; dayStart: number; now: number; today: boolean }) {
  const dayEnd = dayStart + DAY_MS;
  const pct = (t: number) => ((t - dayStart) / DAY_MS) * 100;
  return (
    <div className="relative h-3 flex-1 overflow-hidden rounded-full" style={{ background: "var(--chip-off)" }}>
      {spans
        .filter((s) => s.end > dayStart && s.start < dayEnd)
        .map((s) => {
          const left = pct(Math.max(s.start, dayStart));
          const right = pct(Math.min(s.end, dayEnd));
          return (
            <div
              key={s.start}
              className={clsx("absolute inset-y-0", !today && "opacity-75")}
              style={{ left: `${left}%`, width: `${right - left}%`, background: HOME_GREEN }}
            />
          );
        })}
      {today && (
        <div className="absolute inset-y-0 w-[2px] bg-text" style={{ left: `${pct(now)}%` }} title="Now" />
      )}
    </div>
  );
}

/** When each household member was home over the last 7 days, from their
 * person entity's history — one 24-hour strip per day. */
export function PresenceInsightCard({ index = 0 }: { index?: number }) {
  const { entities, hassUrl } = useHa();
  const now = useNow(60_000);
  const people = HOUSEHOLD_PEOPLE.filter((id) => entities[id]);
  const history = useStateHistory(people, DAYS * 24, { refreshMs: INSIGHTS_REFRESH_MS });
  if (people.length === 0) return null;

  const t = now.getTime();
  const starts = dayStarts(now);

  return (
    <div
      className="glass rise flex flex-col gap-4 rounded-[26px] p-5"
      style={{ background: `color-mix(in srgb, ${TINT} var(--tint-strength), var(--glass))`, animationDelay: `${100 + index * 70}ms` }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: "var(--chip-off)", color: HOME_GREEN }}
        >
          <House size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[19px] font-semibold tracking-[-0.3px] text-text">Who was home</div>
          <div className="truncate text-[13px] text-text-dim">Times of day at home, last 7 days</div>
        </div>
      </div>

      {people.map((id) => {
        const person = entities[id];
        const name = (person.attributes.friendly_name as string | undefined) ?? id.split(".")[1];
        const picture = person.attributes.entity_picture as string | undefined;
        const points = history?.[id] ?? [];
        const spans = spansIn(points, "home", starts[0], t);
        const days = minutesPerDay(points, "home", starts, t);
        const weekAvg = days.slice(0, -1).reduce((a, b) => a + b, 0) / (DAYS - 1);

        return (
          <div key={id} className="flex flex-col gap-2 border-t border-text-dim/15 pt-3">
            <div className="flex items-center gap-2.5">
              {picture ? (
                <img src={`${hassUrl ?? ""}${picture}`} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chip text-sm font-semibold text-text">
                  {name.charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[15px] font-semibold text-text">{name}</div>
                <div className="truncate text-xs text-text-dim">
                  {history ? `${hm(days[DAYS - 1])} home today · ${hm(weekAvg)} a day before that` : "Loading…"}
                </div>
              </div>
            </div>

            {history ? (
              <div className="flex flex-col gap-1">
                {starts.map((s, i) => {
                  const today = i === starts.length - 1;
                  return (
                    <div key={s} className="flex items-center gap-2">
                      <span className={clsx("w-9 shrink-0 text-[11px]", today ? "font-bold text-text" : "text-text-dim")}>
                        {today ? "Today" : new Date(s).toLocaleDateString(undefined, { weekday: "short" })}
                      </span>
                      <DayStrip spans={spans} dayStart={s} now={t} today={today} />
                    </div>
                  );
                })}
                <div className="relative ml-11 h-3 text-[10px] text-text-dim">
                  {HOUR_TICKS.map(([h, label]) => (
                    <span key={h} className="absolute" style={{ left: `${(h / 24) * 100}%` }}>
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-28 animate-pulse rounded-2xl bg-chip" />
            )}
          </div>
        );
      })}
    </div>
  );
}
