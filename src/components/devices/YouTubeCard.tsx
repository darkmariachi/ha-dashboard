import { TvMinimalPlay } from "lucide-react";
import { YOUTUBE } from "../../config/youtube";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { useStateHistory, type StatePoint } from "../home/useStateHistory";
import { DAYS, Dot, WeekChart, addSpan, dayStarts, hm, lastSeen, mondayStart } from "./screenTime";

const KIDS = "#ff0033"; // YouTube red
const MAIN = "#3ea6ff"; // YouTube's link blue
const TINT = "#fde0e0";
const REFRESH_MS = 5 * 60 * 1000;

type Kind = "kids" | "youtube";
const LABEL: Record<Kind, string> = { kids: "YouTube Kids", youtube: "YouTube" };

/** Which YouTube app (if any) a media-player state has in the foreground. */
function kindOf(state: string, attributes: Record<string, unknown> | undefined): Kind | undefined {
  if (YOUTUBE.offStates.includes(state)) return undefined;
  return YOUTUBE.apps[attributes?.app_id as string];
}

/** Minutes per day one TV spent on each YouTube app. */
function daily(points: StatePoint[], starts: number[], now: number) {
  const totals: Record<Kind, number[]> = {
    kids: new Array<number>(DAYS).fill(0),
    youtube: new Array<number>(DAYS).fill(0),
  };
  points.forEach((p, i) => {
    const kind = kindOf(p.state, p.attributes);
    if (!kind) return;
    addSpan(totals[kind], Math.max(p.t, starts[0]), i + 1 < points.length ? points[i + 1].t : now, starts, now);
  });
  return totals;
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

/** The kids' YouTube and YouTube Kids time across every TV: what's on
 * now, today and this week, 7 days stacked, and this week per TV. */
export function YouTubeCard({ index = 0 }: { index?: number }) {
  const { entities, entitiesWithArea } = useHa();
  const now = useNow(60_000);
  const players = Object.values(entitiesWithArea)
    .filter((e) => e.domain === "media_player" && e.platform === YOUTUBE.platform)
    .map((e) => e.entityId)
    .sort();
  const history = useStateHistory(players, DAYS * 24, { withAttributes: true, refreshMs: REFRESH_MS });
  if (players.length === 0) return null;

  const starts = dayStarts(now);
  const monday = mondayStart(now);
  const loaded = history !== null && players.some((id) => history[id]);
  const perTv = players.map((id) => ({
    id,
    name: entitiesWithArea[id].friendlyName,
    days: daily(history?.[id] ?? [], starts, now.getTime()),
  }));
  const days: Record<Kind, number[]> = {
    kids: starts.map((_, d) => sum(perTv.map((tv) => tv.days.kids[d]))),
    youtube: starts.map((_, d) => sum(perTv.map((tv) => tv.days.youtube[d]))),
  };
  const week = (values: number[]) => sum(values.filter((_, d) => starts[d] >= monday));
  const tvWeeks = perTv
    .map((tv) => ({ ...tv, kids: week(tv.days.kids), youtube: week(tv.days.youtube) }))
    .filter((tv) => tv.kids + tv.youtube >= 1)
    .sort((a, b) => b.kids + b.youtube - (a.kids + a.youtube));

  const watching = players.flatMap((id) => {
    const kind = kindOf(entities[id].state, entities[id].attributes);
    return kind ? [{ id, kind, name: entitiesWithArea[id].friendlyName }] : [];
  });
  const status =
    watching.length === 0
      ? "Not watching"
      : watching.length === 1
        ? `${LABEL[watching[0].kind]} on ${watching[0].name}`
        : `On ${watching.length} TVs now`;

  const firstTracked = Math.min(...players.map((id) => history?.[id]?.[0]?.t ?? Infinity));
  const partial = loaded && Number.isFinite(firstTracked) && firstTracked > starts[0] + 3600000;

  return (
    <div
      className="glass rise flex flex-col gap-4 rounded-[26px] p-5"
      style={{ background: `color-mix(in srgb, ${TINT} var(--tint-strength), var(--glass))`, animationDelay: `${100 + index * 70}ms` }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: "var(--chip-off)", color: KIDS }}
        >
          <TvMinimalPlay size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[19px] font-semibold tracking-[-0.3px] text-text">{YOUTUBE.title}</div>
          <div className="truncate text-[13px] text-text-dim">{status}</div>
        </div>
        {watching.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-text-dim">
            <span className="live-dot h-2 w-2 rounded-full" style={{ background: watching[0].kind === "kids" ? KIDS : MAIN }} />
            Live
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["Today", days.kids[DAYS - 1], days.youtube[DAYS - 1]],
            ["This week", week(days.kids), week(days.youtube)],
          ] as const
        ).map(([label, k, y]) => (
          <div key={label} className="rounded-2xl px-3.5 py-3" style={{ background: "var(--chip-off)" }}>
            <div className="text-xs text-text-dim">{label}</div>
            <div className="text-[26px] font-light leading-tight tracking-[-0.5px] tabular-nums text-text">{hm(k + y)}</div>
            <div className="flex flex-wrap gap-x-2.5 text-xs text-text-dim">
              <span className="flex items-center gap-1">
                <Dot color={KIDS} /> {hm(k)}
              </span>
              <span className="flex items-center gap-1">
                <Dot color={MAIN} /> {hm(y)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Last 7 days</span>
          <span className="flex gap-3 text-[11px] text-text-dim">
            <span className="flex items-center gap-1">
              <Dot color={KIDS} /> Kids
            </span>
            <span className="flex items-center gap-1">
              <Dot color={MAIN} /> YouTube
            </span>
          </span>
        </div>
        {loaded ? (
          <WeekChart
            series={[
              { color: MAIN, days: days.youtube },
              { color: KIDS, days: days.kids },
            ]}
            starts={starts}
          />
        ) : (
          <div className="h-28 animate-pulse rounded-2xl bg-chip" />
        )}
        {partial && (
          <p className="text-xs text-text-dim">History starts {lastSeen(firstTracked, now)}. Earlier days aren't counted.</p>
        )}
      </div>

      {tvWeeks.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-text-dim/15 pt-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">This week by TV</span>
          {tvWeeks.map((tv) => (
            <div key={tv.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate text-text">{tv.name}</span>
              <span className="shrink-0 tabular-nums text-text-dim">{hm(tv.kids + tv.youtube)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
