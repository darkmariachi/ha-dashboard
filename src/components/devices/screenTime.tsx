import clsx from "clsx";

/** Days shown on the screen-time cards' charts, today included. */
export const DAYS = 7;

/** Minutes -> "1 h 25 min" / "12 min". */
export function hm(mins: number) {
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/** Local midnights for the last DAYS days, oldest first. */
export function dayStarts(now: Date) {
  const out: number[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push(d.getTime());
  }
  return out;
}

/** Local midnight of this week's Monday. */
export function mondayStart(now: Date) {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.getTime();
}

/** Adds the minutes between `start` and `end` to the days they fall on,
 * splitting spans that cross midnight. */
export function addSpan(totals: number[], start: number, end: number, starts: number[], now: number) {
  starts.forEach((s, d) => {
    const dayEnd = d + 1 < starts.length ? starts[d + 1] : now;
    const overlap = Math.min(end, dayEnd) - Math.max(start, s);
    if (overlap > 0) totals[d] += overlap / 60000;
  });
}

/** "today 4:12 PM" / "yesterday 4:12 PM" / "Tue 4:12 PM". */
export function lastSeen(t: number | undefined, now: Date) {
  if (t === undefined || Number.isNaN(t)) return null;
  const time = new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (t >= startOfToday.getTime()) return `today ${time}`;
  if (t >= startOfToday.getTime() - 86400000) return `yesterday ${time}`;
  return `${new Date(t).toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />;
}

/** Stacked minutes-per-day bars; `series` are drawn top to bottom. */
export function WeekChart({ series, starts }: { series: { color: string; days: number[] }[]; starts: number[] }) {
  const totals = starts.map((_, i) => series.reduce((sum, s) => sum + s.days[i], 0));
  const max = Math.max(60, ...totals);
  return (
    <div className="flex h-28 items-end gap-2">
      {starts.map((s, i) => {
        const total = totals[i];
        const today = i === starts.length - 1;
        return (
          <div key={s} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-semibold tabular-nums text-text-dim">
              {total >= 3 ? (total >= 60 ? `${(total / 60).toFixed(1)}h` : `${Math.round(total)}m`) : ""}
            </span>
            <div className={clsx("flex h-16 w-full flex-col justify-end overflow-hidden rounded-md", !today && "opacity-70")}>
              {total > 0 ? (
                series.map((sr) => (
                  <div key={sr.color} style={{ height: `${(sr.days[i] / max) * 100}%`, background: sr.color }} />
                ))
              ) : (
                <div className="h-[2px] bg-text-dim/30" />
              )}
            </div>
            <span className={clsx("text-[11px]", today ? "font-bold text-text" : "text-text-dim")}>
              {today ? "Today" : new Date(s).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
