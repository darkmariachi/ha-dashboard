import { Gamepad2, Plus } from "lucide-react";
import { GAMING } from "../../config/gaming";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { useStateHistory, type StatePoint } from "../home/useStateHistory";
import { DAYS, Dot, WeekChart, addSpan, dayStarts, hm, lastSeen, mondayStart } from "./screenTime";

const PS5 = "#0070d1"; // PlayStation blue
const SWITCH = "#e60012"; // Nintendo red
const TINT = "#d3e6fb";
const BONUS_MINUTES = 15;

function dayIndex(t: number, starts: number[]) {
  for (let i = starts.length - 1; i >= 0; i--) if (t >= starts[i]) return i;
  return -1;
}

/** PS5: minutes per day spent in an active media-player state. */
function ps5Daily(points: StatePoint[], active: string[], starts: number[], now: number) {
  const totals = new Array<number>(DAYS).fill(0);
  points.forEach((p, i) => {
    if (!active.includes(p.state)) return;
    addSpan(totals, Math.max(p.t, starts[0]), i + 1 < points.length ? points[i + 1].t : now, starts, now);
  });
  return totals;
}

/** Switch: the sensor is "minutes used today" and resets at midnight, so a
 * day's total is its highest reading. */
function switchDaily(points: StatePoint[], starts: number[]) {
  const totals = new Array<number>(DAYS).fill(0);
  for (const p of points) {
    const v = parseFloat(p.state);
    const d = dayIndex(p.t, starts);
    if (d >= 0 && Number.isFinite(v)) totals[d] = Math.max(totals[d], v);
  }
  return totals;
}

/** Andy's console time across the PS5 and the Switch: what he's on now,
 * today and this week, 7 days stacked, and the Switch's daily limit. */
export function GamingCard({ index = 0 }: { index?: number }) {
  const { entities, entitiesWithArea, callService, hassUrl } = useHa();
  const now = useNow(60_000);
  const { ps5, nintendo } = GAMING;
  const history = useStateHistory([ps5.player, nintendo.usedToday], DAYS * 24);
  const player = entities[ps5.player];
  const used = entities[nintendo.usedToday];
  if (!player && !used) return null;

  // --- PS5
  const ps5State = player?.state;
  const ps5Active = ps5State !== undefined && ps5.activeStates.includes(ps5State);
  const title = player?.attributes.media_title as string | undefined;
  const cover = player?.attributes.entity_picture as string | undefined;
  const ps5TodayMin = (parseFloat(entities[ps5.today]?.state ?? "") || 0) * 60;
  const ps5WeekMin = (parseFloat(entities[ps5.week]?.state ?? "") || 0) * 60;
  const ps5Seen = lastSeen(new Date(entities[ps5.lastOnline]?.state ?? "").getTime(), now);

  // --- Switch
  const swTodayMin = parseFloat(used?.state ?? "") || 0;
  const swPlaying =
    !!used && swTodayMin > 0 && now.getTime() - new Date(used.last_changed).getTime() < nintendo.playingWindowMinutes * 60000;
  const limit = parseFloat(entities[nintendo.limit]?.state ?? "");
  const hasLimit = Number.isFinite(limit) && limit >= 0;
  const remaining = parseFloat(entities[nintendo.remaining]?.state ?? "");
  const stopAtLimit = entities[nintendo.stopAtLimit]?.state === "on";
  const switchDevice = entitiesWithArea[nintendo.usedToday]?.deviceId;

  // --- History / chart
  const starts = dayStarts(now);
  const ps5Points = history?.[ps5.player] ?? [];
  const swPoints = history?.[nintendo.usedToday] ?? [];
  const ps5Days = history ? ps5Daily(ps5Points, ps5.activeStates, starts, now.getTime()) : null;
  const swDays = history ? switchDaily(swPoints, starts) : null;
  if (swDays) swDays[DAYS - 1] = Math.max(swDays[DAYS - 1], swTodayMin);
  // Monday-based week for the Switch, to match the PS5 week sensor.
  const monday = mondayStart(now);
  const swWeekMin = swDays ? swDays.reduce((sum, v, i) => (starts[i] >= monday ? sum + v : sum), 0) : swTodayMin;

  const firstTracked = Math.min(ps5Points[0]?.t ?? Infinity, swPoints[0]?.t ?? Infinity);
  const partial = history && Number.isFinite(firstTracked) && firstTracked > starts[0] + 3600000;

  const status = swPlaying
    ? "Playing on the Switch now"
    : ps5State === "playing"
      ? "Playing on PS5 now"
      : ps5Active
        ? "Online on PS5"
        : ps5Seen
          ? `Last on PS5 ${ps5Seen}`
          : "Not playing";

  function act(domain: string, service: string, data: Record<string, unknown>, entityId?: string) {
    navigator.vibrate?.(12);
    callService(domain, service, data, entityId ? { entity_id: entityId } : undefined).catch(() => {});
  }

  return (
    <div
      className="glass rise flex flex-col gap-4 rounded-[26px] p-5"
      style={{ background: `color-mix(in srgb, ${TINT} var(--tint-strength), var(--glass))`, animationDelay: `${100 + index * 70}ms` }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: "var(--chip-off)", color: PS5 }}
        >
          <Gamepad2 size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[19px] font-semibold tracking-[-0.3px] text-text">{GAMING.kid}'s gaming</div>
          <div className="truncate text-[13px] text-text-dim">{status}</div>
        </div>
        {(ps5Active || swPlaying) && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-text-dim">
            <span className="live-dot h-2 w-2 rounded-full" style={{ background: swPlaying ? SWITCH : PS5 }} />
            Live
          </span>
        )}
      </div>

      {ps5Active && title && (
        <div className="flex items-center gap-3 rounded-2xl p-2.5" style={{ background: "var(--chip-off)" }}>
          {cover && <img src={`${hassUrl ?? ""}${cover}`} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />}
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Now playing on PS5</div>
            <div className="truncate text-[15px] font-semibold text-text">{title}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["Today", ps5TodayMin, swTodayMin],
            ["This week", ps5WeekMin, swWeekMin],
          ] as const
        ).map(([label, p, s]) => (
          <div key={label} className="rounded-2xl px-3.5 py-3" style={{ background: "var(--chip-off)" }}>
            <div className="text-xs text-text-dim">{label}</div>
            <div className="text-[26px] font-light leading-tight tracking-[-0.5px] tabular-nums text-text">{hm(p + s)}</div>
            <div className="flex flex-wrap gap-x-2.5 text-xs text-text-dim">
              {player && (
                <span className="flex items-center gap-1">
                  <Dot color={PS5} /> {hm(p)}
                </span>
              )}
              {used && (
                <span className="flex items-center gap-1">
                  <Dot color={SWITCH} /> {hm(s)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Last 7 days</span>
          <span className="flex gap-3 text-[11px] text-text-dim">
            <span className="flex items-center gap-1">
              <Dot color={PS5} /> PS5
            </span>
            <span className="flex items-center gap-1">
              <Dot color={SWITCH} /> Switch
            </span>
          </span>
        </div>
        {ps5Days && swDays ? (
          <WeekChart
            series={[
              { color: SWITCH, days: swDays },
              { color: PS5, days: ps5Days },
            ]}
            starts={starts}
          />
        ) : (
          <div className="h-28 animate-pulse rounded-2xl bg-chip" />
        )}
        {partial && (
          <p className="text-xs text-text-dim">
            Tracking started {lastSeen(firstTracked, now)}. Earlier days fill in as he plays.
          </p>
        )}
      </div>

      {used && (
        <div className="flex flex-col gap-2.5 border-t border-text-dim/15 pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Switch daily limit</span>
            <span className="text-xs text-text-dim">
              {hasLimit
                ? Number.isFinite(remaining)
                  ? `${hm(Math.max(0, remaining))} left today`
                  : `${hm(limit)} a day`
                : "No limit, tracking only"}
            </span>
          </div>
          <div className="flex gap-1 rounded-full p-1" style={{ background: "var(--chip-off)" }}>
            {nintendo.limitPresets.map((m) => {
              const current = m < 0 ? !hasLimit : hasLimit && limit === m;
              return (
                <button
                  key={m}
                  onClick={() => act("number", "set_value", { value: m }, nintendo.limit)}
                  className="flex-1 rounded-full py-1.5 text-xs font-semibold transition-colors"
                  style={current ? { background: SWITCH, color: "#fff" } : { color: "var(--color-text-dim)" }}
                >
                  {m < 0 ? "None" : `${m / 60} h`}
                </button>
              );
            })}
          </div>
          {hasLimit && (
            <div className="flex gap-2">
              {switchDevice && (
                <button
                  onClick={() =>
                    act("nintendo_parental_controls", "add_bonus_time", { bonus_time: BONUS_MINUTES, device_id: switchDevice })
                  }
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold text-text active:scale-95"
                  style={{ background: "var(--chip-off)" }}
                >
                  <Plus size={14} /> {BONUS_MINUTES} min today
                </button>
              )}
              <button
                onClick={() => act("switch", stopAtLimit ? "turn_off" : "turn_on", {}, nintendo.stopAtLimit)}
                aria-pressed={stopAtLimit}
                className="flex flex-1 items-center justify-center rounded-full py-2 text-xs font-semibold transition-colors active:scale-95"
                style={stopAtLimit ? { background: SWITCH, color: "#fff" } : { background: "var(--chip-off)", color: "var(--color-text)" }}
              >
                {stopAtLimit ? "Stops at limit" : "Just warns at limit"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
