import { addSpan, DAYS } from "../devices/screenTime";
import type { StatePoint } from "../home/useStateHistory";

/** Spans [start, end) during which an entity was in `state`, clipped to
 * `from`..`now`. The last span runs up to `now` if it's still ongoing. */
export function spansIn(points: StatePoint[], state: string, from: number, now: number) {
  const out: { start: number; end: number }[] = [];
  points.forEach((p, i) => {
    if (p.state !== state) return;
    const start = Math.max(p.t, from);
    const end = i + 1 < points.length ? points[i + 1].t : now;
    if (end > start) out.push({ start, end });
  });
  return out;
}

/** Minutes per day (the last DAYS days, oldest first) spent in `state`. */
export function minutesPerDay(points: StatePoint[], state: string, starts: number[], now: number) {
  const totals = new Array<number>(DAYS).fill(0);
  for (const s of spansIn(points, state, starts[0], now)) addSpan(totals, s.start, s.end, starts, now);
  return totals;
}
