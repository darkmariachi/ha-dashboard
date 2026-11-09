import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Activity, Check, Combine, Eye, EyeOff, History, Pencil, Radar, X } from "lucide-react";
import {
  backfillNilm,
  deviceName,
  followNilm,
  hideDevice,
  legLabel,
  mergeDevices,
  nilmDeviceRuns,
  nilmDevices,
  nilmLive,
  nilmStatus,
  renameDevice,
  type NilmDevice,
  type NilmEvent,
  type NilmMessage,
  type NilmRun,
  type NilmSample,
  type NilmStatus,
} from "../../lib/nilm";
import { useNow } from "../../lib/useNow";
import { Btn, C, Dot, Label, Panel, Segmented } from "./ui";

// Unnamed-device detection (nilm/ service): the part of the house load
// Sense hasn't identified, split into devices by their on/off steps.

type Win = "15m" | "1h" | "6h" | "24h";
const WIN_S: Record<Win, number> = { "15m": 900, "1h": 3600, "6h": 21600, "24h": 86400 };

const kw = (w: number) => (Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(w >= 10000 ? 0 : 1)} kW` : `${Math.round(w)} W`);
const mins = (m: number | null) => (m === null ? "—" : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);
const ago = (t: number, now: number) => {
  const s = Math.max(0, now / 1000 - t);
  return s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* ---------------------------------------------------------- live chart */

function LiveChart({
  samples,
  events,
  devices,
  windowS,
}: {
  samples: NilmSample[];
  events: NilmEvent[];
  devices: Map<number, NilmDevice>;
  windowS: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const now = useNow(1000).getTime() / 1000;
  const t0 = now - windowS;
  const pts = samples.filter((s) => s.t >= t0);
  const H = 170, L = 44, R = 8, T = 8, B = 20;
  const max = Math.max(500, ...pts.map((p) => p.other)) * 1.08;
  const x = (t: number) => L + ((t - t0) / windowS) * (width - L - R);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  // stepped path: the load holds its value until the next sample
  let d = "";
  pts.forEach((p, i) => {
    d += i === 0 ? `M${x(p.t)},${y(p.other)}` : `H${x(p.t)}V${y(p.other)}`;
  });
  // hold the last reading up to now, but not across a gap (source down)
  if (pts.length) d += `H${x(Math.min(now, pts[pts.length - 1].t + 300))}`;
  const area = pts.length ? `${d}V${y(0)}H${x(pts[0].t)}Z` : "";

  // one lane per device that ran in the window, busiest first
  const inWin = events.filter((e) => (e.t_off ?? now) >= t0);
  const laneIds = [...new Set(inWin.map((e) => e.cluster))]
    .filter((id) => devices.has(id) && !devices.get(id)!.hidden)
    .sort((a, b) => (devices.get(b)!.kwh_7d ?? 0) - (devices.get(a)!.kwh_7d ?? 0))
    .slice(0, 8);
  const laneH = 14;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const ticks: number[] = [];
  const step = windowS <= 900 ? 180 : windowS <= 3600 ? 600 : windowS <= 21600 ? 3600 : 3 * 3600;
  for (let t = Math.ceil(t0 / step) * step; t < now; t += step) ticks.push(t);

  const hv = hover === null ? null : t0 + ((hover - L) / (width - L - R)) * windowS;
  const hs = hv === null ? null : [...pts].reverse().find((p) => p.t <= hv) ?? null;
  const hon = hv === null ? [] : inWin.filter((e) => e.t_on <= hv && (e.t_off ?? now) >= hv);

  return (
    <div ref={ref} className="relative select-none" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={H + laneIds.length * laneH + (laneIds.length ? 8 : 0)} className="block overflow-visible">
        <defs>
          <linearGradient id="nilm-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={C.primary} stopOpacity="0.28" />
            <stop offset="1" stopColor={C.primary} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={width - R} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,0.06)" />
            <text x={L - 6} y={y(g) + 3} textAnchor="end" className="dx-num" fontSize="9.5" fill={C.faint}>
              {kw(g)}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 5} textAnchor="middle" className="dx-num" fontSize="9.5" fill={C.faint}>
            {clock(t)}
          </text>
        ))}
        {/* on-steps as ticks on the chart */}
        {inWin
          .filter((e) => e.t_on >= t0 && devices.has(e.cluster))
          .map((e) => (
            <line key={e.id} x1={x(e.t_on)} x2={x(e.t_on)} y1={T} y2={H - B} stroke={devices.get(e.cluster)!.color} strokeOpacity="0.35" strokeDasharray="2 3" />
          ))}
        {area && <path d={area} fill="url(#nilm-fill)" />}
        {d && <path d={d} fill="none" stroke={C.primary} strokeWidth="1.6" strokeLinejoin="round" />}
        {/* device lanes */}
        {laneIds.map((id, i) => {
          const dev = devices.get(id)!;
          const ly = H + 4 + i * laneH;
          return (
            <g key={id}>
              <text x={L - 6} y={ly + 9} textAnchor="end" fontSize="9.5" fill={C.dim}>
                {dev.name ? dev.name.slice(0, 7) : dev.label}
              </text>
              <line x1={L} x2={width - R} y1={ly + 6} y2={ly + 6} stroke="rgba(255,255,255,0.05)" />
              {inWin
                .filter((e) => e.cluster === id)
                .map((e) => {
                  const a = x(Math.max(t0, e.t_on));
                  const b = x(e.t_off ?? now);
                  return <rect key={e.id} x={a} y={ly + 1} width={Math.max(2, b - a)} height={10} rx={3} fill={dev.color} fillOpacity={e.t_off ? 0.75 : 1} />;
                })}
            </g>
          );
        })}
        {hover !== null && hover >= L && <line x1={hover} x2={hover} y1={T} y2={H + laneIds.length * laneH} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />}
        <rect
          x={L}
          y={0}
          width={Math.max(0, width - L - R)}
          height={H + laneIds.length * laneH}
          fill="transparent"
          onMouseMove={(e) => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left + L)}
        />
      </svg>
      {hv !== null && hover !== null && hs && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-md border border-dx-line bg-dx-raise/95 px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{ left: Math.min(hover + 12, width - 200) }}
        >
          <div className="mb-0.5 font-semibold text-dx-text">{clock(hv)}</div>
          <div className="flex justify-between gap-3 text-dx-dim">
            <span>Unidentified</span>
            <span className="dx-num text-dx-text">{kw(hs.other)}</span>
          </div>
          {hon.map((e) => {
            const dev = devices.get(e.cluster);
            return dev ? (
              <div key={e.id} className="text-dx-dim">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: dev.color }} />
                    {deviceName(dev)}
                  </span>
                  <span className="dx-num text-dx-text">{kw(e.dp)}</span>
                </div>
                <div className="dx-num pl-3.5 text-[10px] text-dx-faint">
                  {clock(e.t_on)}–{e.t_off ? clock(e.t_off) : "now"} · {mins(((e.t_off ?? now) - e.t_on) / 60)} · #{e.id}
                </div>
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- device card */

const hourName = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const dayClock = (t: number) =>
  new Date(t * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const END_TEXT: Record<NilmRun["end"], string> = {
  observed: "off seen",
  inferred: "off inferred",
  dropped: "end unknown",
  running: "running",
};

/** One run, as a tooltip row: when, how long, step sizes, how it ended. */
function RunRow({ r, now }: { r: NilmRun; now: number }) {
  const dur = ((r.t_off ?? now) - r.t_on) / 60;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-dx-line py-1 first:border-0">
      <span className="dx-num text-dx-text">{dayClock(r.t_on)}</span>
      <span className="dx-num text-right text-dx-text">{r.end === "dropped" ? "—" : mins(dur)}</span>
      <span className="dx-num text-dx-faint">
        +{kw(r.dp)}
        {r.dp_off != null && ` / −${kw(r.dp_off)}`} · {legLabel(r.sig)}
      </span>
      <span className="text-right text-dx-faint">
        {END_TEXT[r.end]} · {r.source} · #{r.id}
      </span>
    </div>
  );
}

/**
 * When it turns on, by local hour over the last 7 days. Hovering a bar lists
 * the runs that started in that hour (fetched once per hover session).
 */
function HourBars({ dev, now }: { dev: NilmDevice; now: number }) {
  const { hours, color } = dev;
  const m = Math.max(1, ...hours);
  const [hover, setHover] = useState<number | null>(null);
  const [runs, setRuns] = useState<NilmRun[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fetched = useRef<string | null>(null);
  // refetch when the device's run count changes (a new run, a merge)
  const key = `${dev.id}:${dev.runs_7d}`;
  useEffect(() => {
    if (hover === null || fetched.current === key) return;
    fetched.current = key;
    nilmDeviceRuns(dev.id)
      .then((r) => {
        setRuns(r);
        setErr(null);
      })
      .catch((e) => setErr(String(e.message ?? e)));
  }, [hover, key, dev.id]);

  const inHour = hover === null || !runs ? [] : runs.filter((r) => new Date(r.t_on * 1000).getHours() === hover);
  const shownRuns = inHour.slice(0, 8);
  const durs = inHour.filter((r) => r.end === "observed" && r.t_off).map((r) => (r.t_off! - r.t_on) / 60);
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className="flex h-7 items-end gap-[2px]">
        {hours.map((h, i) => (
          <div key={i} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
            <div
              className="w-full rounded-[1px] transition-opacity"
              style={{
                height: `${Math.max(6, (h / m) * 100)}%`,
                background: h ? color : "rgba(255,255,255,0.06)",
                opacity: hover === i ? 1 : h ? 0.35 + 0.65 * (h / m) : 1,
                outline: hover === i ? `1px solid ${color}` : undefined,
              }}
            />
          </div>
        ))}
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-1.5 w-[300px] rounded-md border border-dx-line bg-dx-raise/95 px-2.5 py-1.5 text-[10.5px] shadow-lg"
          style={{ left: `clamp(0px, calc(${((hover + 0.5) / 24) * 100}% - 150px), calc(100% - 300px))` }}
        >
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="font-semibold text-dx-text">
              {hourName(hover)}–{hourName((hover + 1) % 24)}
            </span>
            <span className="text-dx-dim">
              {hours[hover]} run{hours[hover] === 1 ? "" : "s"} started · last 7 days
              {durs.length > 0 && ` · median ${mins([...durs].sort((a, b) => a - b)[Math.floor(durs.length / 2)])}`}
            </span>
          </div>
          {err ? (
            <div className="text-dx-faint">Couldn't load runs: {err}</div>
          ) : !runs ? (
            <div className="text-dx-faint">Loading runs…</div>
          ) : inHour.length === 0 ? (
            <div className="text-dx-faint">No runs started in this hour.</div>
          ) : (
            <>
              {shownRuns.map((r) => (
                <RunRow key={r.id} r={r} now={now / 1000} />
              ))}
              {inHour.length > shownRuns.length && <div className="pt-1 text-dx-faint">+{inHour.length - shownRuns.length} earlier</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DeviceCard({
  dev,
  now,
  selecting,
  selected,
  onSelect,
  onChanged,
}: {
  dev: NilmDevice;
  now: number;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(dev.name ?? "");
  const on = dev.on_w > 0;
  const save = async () => {
    await renameDevice(dev.id, name);
    setEditing(false);
    onChanged();
  };
  return (
    <div
      onClick={selecting ? onSelect : undefined}
      className={clsx(
        "relative flex flex-col gap-2 rounded-lg border bg-white/[0.02] p-3 transition-colors",
        selecting && "cursor-pointer",
        selected ? "border-dx-primary" : "border-dx-line",
        dev.hidden && "opacity-50",
      )}
      style={on ? { boxShadow: `inset 0 0 0 1px ${dev.color}55, 0 0 18px -8px ${dev.color}` } : undefined}
    >
      <div className="flex items-center gap-2">
        <Dot color={dev.color} pulse={on} />
        {editing ? (
          <form
            className="flex min-w-0 flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Device ${dev.label}`}
              className="min-w-0 flex-1 rounded border border-dx-line bg-black/30 px-1.5 py-0.5 text-[12px] text-dx-text outline-none focus:border-dx-primary"
            />
            <button type="submit" className="text-dx-primary" aria-label="Save name">
              <Check size={14} />
            </button>
            <button type="button" className="text-dx-dim" aria-label="Cancel" onClick={() => setEditing(false)}>
              <X size={14} />
            </button>
          </form>
        ) : (
          <>
            <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-dx-text">{deviceName(dev)}</div>
            {!selecting && (
              <button className="text-dx-faint hover:text-dx-text" aria-label="Rename" onClick={() => setEditing(true)}>
                <Pencil size={12} />
              </button>
            )}
            {!selecting && (
              <button
                className="text-dx-faint hover:text-dx-text"
                aria-label={dev.hidden ? "Show" : "Hide"}
                title={dev.hidden ? "Show" : "Hide (noise, or not a real device)"}
                onClick={async () => {
                  await hideDevice(dev.id, !dev.hidden);
                  onChanged();
                }}
              >
                {dev.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="dx-num text-[22px] font-semibold leading-none" style={{ color: on ? dev.color : C.text }}>
          {on ? kw(dev.on_w) : `~${kw(dev.watts)}`}
        </div>
        <div className="text-right text-[10.5px] leading-tight text-dx-dim">
          {dev.name ? `Device ${dev.label} · ` : ""}
          {legLabel(dev.sig)}
          <br />
          <span className="dx-num">
            {kw(dev.watts_range[0])}–{kw(dev.watts_range[1])}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10.5px]">
        <div>
          <div className="text-dx-faint">Runs/day</div>
          <div className="dx-num text-dx-text">{dev.runs_per_day}</div>
        </div>
        <div>
          <div className="text-dx-faint">Typical run</div>
          <div className="dx-num text-dx-text">{mins(dev.minutes)}</div>
        </div>
        <div>
          <div className="text-dx-faint">Per day</div>
          <div className="dx-num text-dx-text">{dev.kwh_per_day.toFixed(1)} kWh</div>
        </div>
      </div>
      <HourBars dev={dev} now={now} />
      <div className="flex justify-between text-[10px] text-dx-faint">
        <span>12a</span>
        <span>{on ? <span style={{ color: dev.color }}>on now</span> : dev.last_on ? `last on ${ago(dev.last_on, now)}` : "—"}</span>
        <span>11p</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- section */

export function LoadsSection({ delay = 0 }: { delay?: number }) {
  const [status, setStatus] = useState<NilmStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<NilmDevice[]>([]);
  const [samples, setSamples] = useState<NilmSample[]>([]);
  const [events, setEvents] = useState<NilmEvent[]>([]);
  const [win, setWin] = useState<Win | null>(null);
  const [connected, setConnected] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  // bumped on every stream (re)connect and once a minute, to re-sync the
  // snapshot with anything the stream missed
  const [liveRev, setLiveRev] = useState(0);
  const now = useNow(5000).getTime();
  const slow = (status?.sample_interval_s ?? 999) > 20;
  const span: Win = win ?? (status ? (slow ? "6h" : "15m") : "15m");

  const loadDevices = useCallback(() => {
    nilmDevices()
      .then((d) => {
        setDevices(d);
        setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    nilmStatus().then(setStatus).catch((e) => setError(String(e.message ?? e)));
    loadDevices();
    const t = setInterval(() => {
      nilmStatus().then(setStatus).catch(() => {});
      loadDevices();
    }, 30_000);
    return () => clearInterval(t);
  }, [loadDevices]);

  useEffect(() => {
    let alive = true;
    nilmLive(WIN_S[span])
      .then((r) => {
        if (!alive) return;
        setSamples(r.samples);
        setEvents(r.events);
      })
      .catch(() => {});
    const t = setInterval(() => setLiveRev((r) => r + 1), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [span, liveRev]);

  // live stream: append samples, open/close events, refresh device stats on edges
  const refreshSoon = useRef<number | null>(null);
  useEffect(() => {
    const onMsg = (m: NilmMessage) => {
      if (m.type === "hello") {
        setLiveRev((r) => r + 1);
      } else if (m.type === "sample") {
        setSamples((s) => {
          const cut = m.t - WIN_S["24h"];
          const next = s.length > 6000 ? s.filter((p) => p.t >= cut) : s;
          return [...next, { t: m.t, other: m.other, total: m.total, solar: m.solar }];
        });
        setDevices((ds) => ds.map((d) => ({ ...d, on_w: m.on[String(d.id)] ?? 0 })));
      } else if (m.type === "on") {
        setEvents((es) => [...es, { id: m.event, cluster: m.cluster, label: m.label, t_on: m.t, t_off: null, dp: m.dp, sig: "?" }]);
      } else if (m.type === "off") {
        setEvents((es) => es.map((e) => (e.id === m.event ? { ...e, t_off: m.t } : e)));
      }
      if (m.type === "on" || m.type === "off") {
        if (refreshSoon.current) clearTimeout(refreshSoon.current);
        refreshSoon.current = setTimeout(loadDevices, 1500);
      }
    };
    return followNilm(onMsg, setConnected);
  }, [loadDevices]);

  const byId = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const shown = devices.filter((d) => (showCandidates || !d.candidate) && (showHidden || !d.hidden));
  const candidates = devices.filter((d) => d.candidate).length;
  const hiddenN = devices.filter((d) => d.hidden).length;
  const last = samples[samples.length - 1];
  const onNow = devices.filter((d) => d.on_w > 0 && !d.hidden);
  const explained = devices.filter((d) => !d.hidden && !d.candidate).reduce((s, d) => s + d.kwh_per_day, 0);

  const stale = status?.last_sample_age_s != null && status.sample_interval_s != null && status.last_sample_age_s > status.sample_interval_s * 3 + 30;
  const srcColor = status?.source === "error" || stale ? C.red : status?.source === "sense" ? C.green : C.amber;
  const srcText =
    status == null
      ? error
        ? "offline"
        : "…"
      : status.source === "sense"
        ? `Sense live · ${status.sample_interval_s ?? "?"}s`
        : status.source === "ha"
          ? "HA · ~2 min"
          : status.source === "replay"
            ? "Replay"
            : status.source;

  const recent = [...events].sort((a, b) => b.t_on - a.t_on).slice(0, 40);

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-12">
        <Panel
          title="Unidentified load · live"
          icon={Radar}
          accent={C.primary}
          delay={delay}
          className="xl:col-span-8"
          right={
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] text-dx-dim" title={status?.detail}>
                <Dot color={srcColor} pulse={connected && !stale} />
                {srcText}
              </span>
              <div className="w-[220px]">
                <Segmented<Win> value={span} onChange={setWin} options={(["15m", "1h", "6h", "24h"] as Win[]).map((w) => ({ value: w, label: w }))} />
              </div>
            </div>
          }
        >
          {error && !status ? (
            <div className="py-10 text-center text-[12px] text-dx-dim">Detection service unreachable: {error}</div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-end gap-x-8 gap-y-2">
                <div>
                  <Label>Unidentified now</Label>
                  <div className="dx-num text-[28px] font-semibold leading-tight text-dx-text">{last ? kw(last.other) : "—"}</div>
                </div>
                <div>
                  <Label>Devices on</Label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {onNow.length === 0 && <span className="text-[12px] text-dx-faint">none detected</span>}
                    {onNow.map((d) => (
                      <span key={d.id} className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: `${d.color}66`, color: d.color }}>
                        {deviceName(d)} <span className="dx-num">{kw(d.on_w)}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <Label>Assigned to devices</Label>
                  <div className="dx-num mt-1 text-[13px] text-dx-text">{explained.toFixed(1)} kWh/day</div>
                </div>
              </div>
              <LiveChart samples={samples} events={events} devices={byId} windowS={WIN_S[span]} />
              {slow && status?.source !== "replay" && (
                <p className="mt-2 text-[11px] text-dx-faint">
                  Running on Home Assistant's 2-minute Sense updates: big loads separate well, small ones blur. Add Sense credentials to the service for the live stream.
                </p>
              )}
            </>
          )}
        </Panel>

        <Panel
          title="Detections"
          icon={Activity}
          accent={C.violet}
          delay={delay + 40}
          className="xl:col-span-4"
          bodyClassName="p-0"
          right={<span className="dx-num text-[10.5px] text-dx-faint">{status?.open_events ?? 0} running</span>}
        >
          <div className="max-h-[300px] overflow-y-auto">
            {recent.length === 0 && <div className="p-6 text-center text-[12px] text-dx-faint">No on/off steps yet.</div>}
            {recent.map((e) => {
              const dev = byId.get(e.cluster);
              const color = dev?.color ?? C.dim;
              const running = e.t_off == null;
              return (
                <div key={e.id} className="flex items-center gap-2 border-b border-dx-line px-4 py-[7px] text-[12px] last:border-0">
                  <span className="dx-num w-[58px] shrink-0 text-dx-faint">{clock(e.t_on)}</span>
                  <Dot color={color} pulse={running} />
                  <span className="min-w-0 flex-1 truncate" style={{ color: running ? color : C.text }}>
                    {dev ? deviceName(dev) : `Device ${e.label}`}
                  </span>
                  <span className="dx-num shrink-0 text-dx-dim">+{kw(e.dp)}</span>
                  <span className="dx-num w-[64px] shrink-0 text-right text-dx-faint">
                    {running ? <span style={{ color }}>{mins((now / 1000 - e.t_on) / 60)}</span> : mins((e.t_off! - e.t_on) / 60)}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel
        title={`Unnamed devices · ${shown.length}`}
        icon={Radar}
        accent={C.pink}
        delay={delay + 80}
        right={
          <div className="flex items-center gap-2">
            {selecting ? (
              <>
                <span className="text-[11px] text-dx-dim">{selected.length} selected · first one keeps its name</span>
                <Btn
                  color={C.primary}
                  disabled={selected.length < 2 || busy}
                  onClick={async () => {
                    setBusy(true);
                    await mergeDevices(selected).catch(() => {});
                    setBusy(false);
                    setSelecting(false);
                    setSelected([]);
                    loadDevices();
                  }}
                >
                  <Combine size={12} /> Merge
                </Btn>
                <Btn
                  onClick={() => {
                    setSelecting(false);
                    setSelected([]);
                  }}
                >
                  Cancel
                </Btn>
              </>
            ) : (
              <>
                {candidates > 0 && <Btn onClick={() => setShowCandidates((v) => !v)}>{showCandidates ? "Hide" : "Show"} {candidates} candidates</Btn>}
                {hiddenN > 0 && <Btn onClick={() => setShowHidden((v) => !v)}>{showHidden ? "Hide" : "Show"} {hiddenN} hidden</Btn>}
                <Btn onClick={() => setSelecting(true)} title="Same device split in two? Merge them.">
                  <Combine size={12} /> Merge
                </Btn>
                {status?.source !== "sense" && (
                  <Btn
                    disabled={busy}
                    title="Run the last 10 days of HA's Sense history through the detector"
                    onClick={async () => {
                      setBusy(true);
                      await backfillNilm(10).catch((e) => setError(String(e.message ?? e)));
                      setBusy(false);
                      loadDevices();
                    }}
                  >
                    <History size={12} /> {busy ? "Seeding…" : "Seed from history"}
                  </Btn>
                )}
              </>
            )}
          </div>
        }
      >
        {shown.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-dx-faint">
            No devices yet. Each one appears after it has turned on and off a few times.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {shown.map((d) => (
              <DeviceCard
                key={d.id}
                dev={d}
                now={now}
                selecting={selecting}
                selected={selected.includes(d.id)}
                onSelect={() => setSelected((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]))}
                onChanged={loadDevices}
              />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

