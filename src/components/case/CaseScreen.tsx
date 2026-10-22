import { Cpu, Gauge, MemoryStick, Thermometer, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { HassEntity } from "home-assistant-js-websocket";
import { CURATED_CAMERAS } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { resolveCuratedCamera } from "../../lib/entityHelpers";
import { useNow } from "../../lib/useNow";
import { CameraCard } from "../cards/CameraCard";

/** How much history each graph shows. HASS.Agent reports every ~30 s. */
const WINDOW_MIN = 30;

const ONLINE = "#2fae7e";

/** Stills rather than live MJPEG: this page runs for days, and a live stream
 * that dies mid-way (HA restart, network blip) leaves a black tile without
 * ever firing an error. A fresh still each tick heals itself. */
const CAMERA_SNAPSHOT_MS = 2_000;

interface Stat {
  label: string;
  entityId: string;
  icon: LucideIcon;
  color: string;
  /** Temperatures get their own scale; everything else is 0–100 %. */
  temp?: boolean;
}

const STATS: Stat[] = [
  { label: "CPU", entityId: "sensor.apollo_cpuload", icon: Cpu, color: "#5b8cff" },
  { label: "GPU", entityId: "sensor.apollo_gpuload", icon: Gauge, color: "#3fd08f" },
  { label: "Memory", entityId: "sensor.apollo_memoryusage", icon: MemoryStick, color: "#f2a93b" },
  { label: "GPU temp", entityId: "sensor.apollo_gputemperature", icon: Thermometer, color: "#ff6b6b", temp: true },
];

const ONLINE_ENTITY = "sensor.apollo_sessionstate";
const PING_ENTITY = "switch.apollo_pc";
const BOOT_ENTITY = "sensor.apollo_lastboot";

function reading(e: HassEntity | undefined) {
  if (!e || e.state === "unavailable" || e.state === "unknown") return null;
  const v = parseFloat(e.state);
  return Number.isFinite(v) ? v : null;
}

/** HASS.Agent sends 0 °C for a GPU temperature it can't read, which HA
 * shows as 32 °F. */
function readsTemp(e: HassEntity | undefined) {
  const v = reading(e);
  if (v === null) return false;
  return e!.attributes.unit_of_measurement === "°F" ? v !== 32 : v !== 0;
}

type Point = { t: number; v: number };

/**
 * The last WINDOW_MIN minutes of each sensor: seeded once from HA's history,
 * then extended with every live state change, so the graphs move as the
 * numbers do instead of on a refetch timer.
 */
function useLiveSeries(ids: string[]) {
  const { status, sendMessage, entities } = useHa();
  const [series, setSeries] = useState<Record<string, Point[]>>({});
  const key = ids.join(",");

  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;
    sendMessage<Record<string, { s: string; lu: number }[]>>({
      type: "history/history_during_period",
      start_time: new Date(Date.now() - WINDOW_MIN * 60_000).toISOString(),
      entity_ids: key.split(","),
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    })
      .then((res) => {
        if (cancelled) return;
        const seeded: Record<string, Point[]> = {};
        for (const id of key.split(",")) {
          seeded[id] = (res[id] ?? [])
            .map((p) => ({ t: p.lu * 1000, v: parseFloat(p.s) }))
            .filter((p) => Number.isFinite(p.v));
        }
        // Keep anything that arrived live while the history was loading.
        setSeries((live) => {
          const out: Record<string, Point[]> = {};
          for (const id of Object.keys(seeded)) {
            const last = seeded[id].at(-1)?.t ?? 0;
            out[id] = [...seeded[id], ...(live[id] ?? []).filter((p) => p.t > last)];
          }
          return out;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status, sendMessage, key]);

  // Append each new state. Adjusting state during render (React's documented
  // pattern), keyed on last_updated so a re-render doesn't double-add.
  const stamps = ids.map((id) => entities[id]?.last_updated ?? "").join("|");
  const [seenStamps, setSeenStamps] = useState(stamps);
  if (stamps !== seenStamps) {
    setSeenStamps(stamps);
    setSeries((prev) => {
      const cutoff = Date.now() - WINDOW_MIN * 60_000;
      const next = { ...prev };
      for (const id of ids) {
        const e = entities[id];
        const v = reading(e);
        if (!e || v === null) continue;
        const t = new Date(e.last_updated).getTime();
        const pts = (next[id] ?? []).filter((p) => p.t >= cutoff);
        if (pts.at(-1)?.t !== t) pts.push({ t, v });
        next[id] = pts;
      }
      return next;
    });
  }

  return series;
}

/** Area chart over the window, on a fixed scale so 20 % always looks like
 * 20 % (an auto-scaled sparkline makes idle noise look like a spike). */
function Graph({ points, color, min, max, now }: { points: Point[]; color: string; min: number; max: number; now: number }) {
  const w = 460;
  const h = 84;
  const start = now - WINDOW_MIN * 60_000;
  const visible = points.filter((p) => p.t >= start - 60_000);
  if (visible.length < 2) return <div style={{ height: h }} />;
  const x = (t: number) => Math.max(0, ((t - start) / (now - start)) * w);
  const y = (v: number) => h - (Math.min(max, Math.max(min, v)) - min) / (max - min) * (h - 4) - 2;
  // Step through each reading and carry the last one up to now.
  const pts = [...visible.map((p) => `${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`), `${w} ${y(visible.at(-1)!.v).toFixed(1)}`];
  const line = `M${pts.join(" L")}`;
  const gid = `g-${color.slice(1)}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block w-full" style={{ height: h }} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} x2={w} y1={h * f} y2={h * f} stroke="white" strokeOpacity={0.06} vectorEffect="non-scaling-stroke" />
      ))}
      <path d={`${line} L${w} ${h} L${x(visible[0].t).toFixed(1)} ${h}Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatPanel({ stat, entity, points, now }: { stat: Stat; entity: HassEntity | undefined; points: Point[]; now: number }) {
  const v = reading(entity);
  const unit = stat.temp ? ((entity?.attributes.unit_of_measurement as string | undefined) ?? "°") : "%";
  const vs = points.map((p) => p.v);
  const peak = vs.length ? Math.max(...vs) : null;
  const avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  const [min, max] = stat.temp ? (unit === "°F" ? [80, 200] : [25, 95]) : [0, 100];

  return (
    <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.035] px-5 pb-3 pt-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[15px] font-semibold uppercase tracking-[0.08em] text-white/60">
          <stat.icon size={18} style={{ color: stat.color }} />
          {stat.label}
        </span>
        {peak !== null && avg !== null && (
          <span className="text-[13px] tabular-nums text-white/40">
            avg {Math.round(avg)} · peak {Math.round(peak)}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1 tabular-nums">
        <span className="text-[64px] font-light leading-none tracking-[-2px] text-white">
          {v === null ? "—" : Math.round(v)}
        </span>
        <span className="text-[24px] font-medium text-white/50">{v === null ? "" : unit}</span>
      </div>
      <div className="mt-2">
        <Graph points={points} color={stat.color} min={min} max={max} now={now} />
      </div>
    </div>
  );
}

function uptime(boot: HassEntity | undefined, now: Date) {
  const t = boot ? new Date(boot.state).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${mins % 60}m`;
}

function Header({ online }: { online: boolean }) {
  const { entities } = useHa();
  const now = useNow(1000);
  const h = now.getHours();
  const up = uptime(entities[BOOT_ENTITY], now);

  return (
    <header className="px-1">
      <div className="flex items-center justify-between">
        <span className="text-[22px] font-bold tracking-[0.18em] text-white">APOLLO</span>
        <span className="flex items-center gap-2 text-[15px] font-semibold text-white/60">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: online ? ONLINE : "#6b7186", boxShadow: online ? `0 0 0 4px ${ONLINE}33` : undefined }}
          />
          {online ? (up ? `Up ${up}` : "Online") : "Offline"}
        </span>
      </div>
      <div className="mt-3 text-[96px] font-extralight leading-[0.9] tracking-[-4px] text-white tabular-nums">
        {((h + 11) % 12) + 1}:{String(now.getMinutes()).padStart(2, "0")}
        <span className="ml-2 text-[28px] font-normal tracking-normal text-white/50">{h < 12 ? "AM" : "PM"}</span>
      </div>
      <div className="mt-2 text-[18px] font-medium text-white/50">
        {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </div>
    </header>
  );
}

/**
 * The layout at /case — for the 1920×515 bar screen in APOLLO's HYTE Y60,
 * which computerpi drives rotated into portrait (515 px wide, 1920 tall) in
 * a Chromium kiosk. Display-only, no touch: APOLLO's live stats up top, the
 * sidebar cameras stacked to fill the rest.
 */
export function CaseScreen() {
  const { entities, entitiesWithArea } = useHa();
  const now = useNow(5000).getTime();
  const series = useLiveSeries(STATS.map((s) => s.entityId));
  // Same rule as ComputerCard: HASS.Agent reporting, and the ping not down.
  const session = entities[ONLINE_ENTITY]?.state;
  const online = !!session && session !== "unavailable" && session !== "unknown" && entities[PING_ENTITY]?.state !== "off";
  // Drop GPU temp while HASS.Agent isn't reading one.
  const stats = STATS.filter((s) => !s.temp || readsTemp(entities[s.entityId]));
  const cameras = CURATED_CAMERAS.filter((c) => c.sidebar);

  return (
    <div className="home-night flex h-full cursor-none flex-col gap-4 overflow-hidden bg-[#05060a] p-5 text-white">
      <Header online={online} />
      <div className={online ? "flex flex-col gap-3" : "flex flex-col gap-3 opacity-40"}>
        {stats.map((s) => (
          <StatPanel key={s.entityId} stat={s} entity={entities[s.entityId]} points={series[s.entityId] ?? []} now={now} />
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {cameras.map((cam) => (
          <CameraCard
            key={cam.entityId}
            ent={resolveCuratedCamera(entitiesWithArea, cam)}
            bare
            fill
            snapshotEveryMs={CAMERA_SNAPSHOT_MS}
          />
        ))}
      </div>
    </div>
  );
}
