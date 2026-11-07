import { createElement, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  Activity,
  Cctv,
  DoorOpen,
  Globe,
  HeartPulse,
  Maximize2,
  Monitor,
  Power,
  Thermometer,
  Wifi,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CURATED_COMPUTERS } from "../../config/computers";
import { CURATED_CLIMATE_ENTITY, CURATED_ENERGY, CURATED_VACUUM, CURATED_WEATHER_ENTITY } from "../../config/curatedHome";
import { DESKTOP_ALARM, DESKTOP_APPLIANCES, DESKTOP_INDOOR, DESKTOP_NETWORK, DESKTOP_SAFETY, DESKTOP_SERVER } from "../../config/desktop";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { useCameraEvents, typeInfo } from "../home/ActivityFeed";
import { useOnNow } from "../home/OnNowModal";
import { weatherIcon, weatherLabel } from "../home/statusIcons";
import { useEntityHistory } from "../home/useEntityHistory";
import { useStateHistory } from "../home/useStateHistory";
import { useWeatherForecast, type ForecastEntry } from "../home/useWeatherForecast";
import { BarChart, LineChart, Spark, Timeline } from "./charts";
import { clock, computerOnline, dur, fmtMbps, fmtW, isLive, mbps, num, SENSE, spans, useIssues, useOpenings } from "./data";
import { Big, C, Dot, KV, Label, Panel, Ring, Segmented } from "./ui";

/* ---------------------------------------------------------------- KPIs */

function Kpi({
  label,
  icon: Icon,
  color,
  value,
  unit,
  sub,
  alert,
  children,
  delay,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  color: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  alert?: boolean;
  children?: React.ReactNode;
  delay: number;
  onClick?: () => void;
}) {
  const c = alert ? C.amber : color;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="dx-panel dx-in group relative flex min-w-0 flex-col gap-2 overflow-hidden p-4 text-left transition-colors enabled:hover:border-white/15"
      style={{ animationDelay: `${delay}ms`, ...(alert && { borderColor: `${C.amber}66` }) }}
    >
      <span className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${c}, transparent)` }} />
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Icon size={14} style={{ color: c }} />
      </div>
      <Big value={value} unit={unit} color={alert ? C.amber : undefined} size={34} />
      <div className="dx-num min-h-[16px] truncate text-[11px] text-dx-dim">{sub}</div>
      <div className="mt-auto">{children}</div>
    </button>
  );
}

export function KpiRow({ go }: { go: (page: string) => void }) {
  const { entities, entitiesWithArea } = useHa();
  const usageH = useEntityHistory(CURATED_ENERGY.consumption, 6, 48);
  const solarH = useEntityHistory(CURATED_ENERGY.production, 6, 48);
  const indoorH = useEntityHistory(DESKTOP_INDOOR.temperature, 24, 48);
  const downH = useEntityHistory(DESKTOP_NETWORK.down, 6, 48);
  const { items, indoor, away } = useOnNow();
  const { open } = useOpenings();
  const { issues } = useIssues();

  const usage = num(entities[CURATED_ENERGY.consumption]);
  const solar = Math.max(0, num(entities[CURATED_ENERGY.production]) ?? 0);
  const used = num(entities[`${SENSE}_daily_energy`]);
  const made = num(entities[`${SENSE}_daily_production`]);
  const cover = used && made !== null ? Math.min(100, (made / used) * 100) : null;
  const climate = entities[CURATED_CLIMATE_ENTITY];
  const inside = num(entities[DESKTOP_INDOOR.temperature]) ?? (climate?.attributes.current_temperature as number | undefined) ?? null;
  const rh = num(entities[DESKTOP_INDOOR.humidity]);
  const wanDown = entities[DESKTOP_NETWORK.wan]?.state === "off";
  // The UPnP throughput sensors can go unavailable; fall back to skylab's LAN port.
  const wanKnown = isLive(entities[DESKTOP_NETWORK.down]);
  const lanH = useEntityHistory(DESKTOP_SERVER.nic.rx, 6, 48);
  const leftOn = away && indoor.length > 0;
  const usageParts = usage === null ? null : fmtW(usage).split(" ");
  const clients = Object.values(entitiesWithArea).filter((e) => e.domain === "device_tracker" && e.platform === "unifi" && e.entity.state === "home").length;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
      <Kpi label="Load" icon={Zap} color={C.pink} value={usageParts?.[0] ?? "—"} unit={usageParts?.[1]} sub={`peak 6h ${usageH ? fmtW(Math.max(...usageH)) : "—"}`} delay={0} onClick={() => go("energy")}>
        <Spark values={usageH} color={C.pink} />
      </Kpi>
      <Kpi
        label="Solar"
        icon={Zap}
        color={C.cyan}
        value={fmtW(solar).split(" ")[0]}
        unit={fmtW(solar).split(" ")[1]}
        sub={cover === null ? "—" : `${made!.toFixed(1)} kWh today · ${Math.round(cover)}% of use`}
        delay={40}
        onClick={() => go("energy")}
      >
        <Spark values={solarH?.map((v) => Math.max(0, v)) ?? null} color={C.cyan} />
      </Kpi>
      <Kpi
        label="Indoor"
        icon={Thermometer}
        color={C.violet}
        value={inside === null ? "—" : inside.toFixed(1)}
        unit={`°${rh !== null ? `  ${Math.round(rh)}%rh` : ""}`}
        sub={climate ? `${climate.state.replace(/_/g, " ")}${climate.attributes.temperature ? ` → ${climate.attributes.temperature}°` : ""}${climate.attributes.hvac_action ? ` · ${climate.attributes.hvac_action}` : ""}` : "—"}
        delay={80}
        onClick={() => go("energy")}
      >
        <Spark values={indoorH} color={C.violet} />
      </Kpi>
      {wanKnown ? (
        <Kpi
          label="Internet"
          icon={wanDown ? Globe : Wifi}
          color={C.cyan}
          alert={wanDown}
          value={wanDown ? "DOWN" : fmtMbps(mbps(num(entities[DESKTOP_NETWORK.down])))}
          unit={wanDown ? undefined : "Mb/s"}
          sub={`↑ ${fmtMbps(mbps(num(entities[DESKTOP_NETWORK.up])))} Mb/s`}
          delay={120}
          onClick={() => go("devices")}
        >
          <Spark values={downH?.map((v) => mbps(v)!) ?? null} color={C.cyan} />
        </Kpi>
      ) : (
        <Kpi
          label="LAN · skylab"
          icon={Wifi}
          color={C.green}
          value={num(entities[DESKTOP_SERVER.nic.rx])?.toFixed(1) ?? "—"}
          unit="Mb/s"
          sub={`↑ ${num(entities[DESKTOP_SERVER.nic.tx])?.toFixed(1) ?? "—"} · ${clients} clients`}
          delay={120}
          onClick={() => go("devices")}
        >
          <Spark values={lanH} color={C.green} />
        </Kpi>
      )}
      <Kpi
        label="Powered on"
        icon={Power}
        color={C.amber}
        alert={leftOn}
        value={items.length}
        unit={items.length === 1 ? "device" : "devices"}
        sub={leftOn ? "nobody home" : `${indoor.length} in · ${items.length - indoor.length} out`}
        delay={160}
        onClick={() => go("rooms")}
      >
        <div className="flex h-[34px] items-end gap-[2px]">
          {items.slice(0, 28).map((i) => (
            <span key={i.entityId} title={`${i.room} · ${i.label}`} className="h-full flex-1 rounded-[1px]" style={{ background: i.outdoor ? `${C.cyan}aa` : `${C.amber}cc`, maxWidth: 10 }} />
          ))}
        </div>
      </Kpi>
      <Kpi
        label="Status"
        icon={HeartPulse}
        color={C.green}
        alert={open.length > 0 || issues.some((i) => i.severity === "danger")}
        value={open.length + issues.length === 0 ? "NOMINAL" : `${open.length + issues.length}`}
        unit={open.length + issues.length === 0 ? undefined : "flags"}
        sub={
          open.length + issues.length === 0
            ? "all closed · no issues"
            : [...open.map((o) => `${o.label} open`), ...issues.map((i) => `${i.label} ${i.detail}`)].join(" · ")
        }
        delay={200}
        onClick={() => go("security")}
      >
        <div className="flex h-[34px] items-center gap-3 text-[10.5px] uppercase tracking-[0.12em] text-dx-dim">
          <span className="flex items-center gap-1.5">
            <Dot color={open.length ? C.amber : C.green} /> openings {open.length}
          </span>
          <span className="flex items-center gap-1.5">
            <Dot color={issues.length ? C.amber : C.green} /> issues {issues.length}
          </span>
        </div>
      </Kpi>
    </div>
  );
}

/* --------------------------------------------------------------- Power */

const RANGES = { "6h": [6, 72], "24h": [24, 96], "7d": [168, 168] } as const;
type Range = keyof typeof RANGES;

export function PowerPanel({ defaultRange = "24h", height = 210, delay = 0, className }: { defaultRange?: Range; height?: number; delay?: number; className?: string }) {
  const { entities } = useHa();
  const [range, setRange] = useState<Range>(defaultRange);
  const [hours, buckets] = RANGES[range];
  const usage = useEntityHistory(CURATED_ENERGY.consumption, hours, buckets);
  const solar = useEntityHistory(CURATED_ENERGY.production, hours, buckets);
  const now = num(entities[CURATED_ENERGY.consumption]);
  const sol = Math.max(0, num(entities[CURATED_ENERGY.production]) ?? 0);
  const grid = now === null ? null : now - sol;
  const avg = usage ? usage.reduce((a, b) => a + b, 0) / usage.length : null;

  return (
    <Panel
      title="Power flow"
      icon={Zap}
      accent={C.pink}
      delay={delay}
      className={className}
      right={
        <div className="w-[150px]">
          <Segmented value={range} onChange={setRange} options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: r }))} />
        </div>
      }
    >
      <div className="mb-3 grid grid-cols-4 gap-4">
        <div>
          <Label>Load</Label>
          <Big value={fmtW(now).split(" ")[0]} unit={fmtW(now).split(" ")[1]} color={C.pink} size={24} />
        </div>
        <div>
          <Label>Solar</Label>
          <Big value={fmtW(sol).split(" ")[0]} unit={fmtW(sol).split(" ")[1]} color={C.cyan} size={24} />
        </div>
        <div>
          <Label>{grid !== null && grid < 0 ? "Export" : "Import"}</Label>
          <Big value={fmtW(grid === null ? null : Math.abs(grid)).split(" ")[0]} unit={fmtW(grid === null ? null : Math.abs(grid)).split(" ")[1]} color={grid !== null && grid < 0 ? C.green : C.text} size={24} />
        </div>
        <div>
          <Label>Avg {range}</Label>
          <Big value={fmtW(avg).split(" ")[0]} unit={fmtW(avg).split(" ")[1]} size={24} />
        </div>
      </div>
      <LineChart
        hours={hours}
        height={height}
        floor={0}
        format={(v) => fmtW(v)}
        series={[
          ...(usage ? [{ label: "Load", values: usage, color: C.pink, fill: true }] : []),
          ...(solar ? [{ label: "Solar", values: solar.map((v) => Math.max(0, v)), color: C.cyan, fill: true }] : []),
        ]}
      />
    </Panel>
  );
}

/* ------------------------------------------------------------- Weather */

type Forecast = ForecastEntry & { precipitation_probability?: number };

function compass(deg: number | undefined) {
  return deg === undefined ? "" : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

export function WeatherPanel({ delay = 0, className }: { delay?: number; className?: string }) {
  const { entities } = useHa();
  const now = useNow(60_000);
  const w = entities[CURATED_WEATHER_ENTITY];
  const sun = entities["sun.sun"];
  const hourly = useWeatherForecast(CURATED_WEATHER_ENTITY, "hourly") as Forecast[] | null;
  const daily = useWeatherForecast(CURATED_WEATHER_ENTITY, "daily") as Forecast[] | null;
  const a = w?.attributes ?? {};
  const next = (hourly ?? []).filter((f) => new Date(f.datetime).getTime() > now.getTime()).slice(0, 12);
  const week = (daily ?? []).slice(0, 7);
  const lo = Math.min(...week.map((d) => d.templow ?? d.temperature ?? 0));
  const hi = Math.max(...week.map((d) => d.temperature ?? 0));
  const t = (iso: unknown) => (typeof iso === "string" ? clock(new Date(iso).getTime()) : "—");

  return (
    <Panel title="Atmosphere" icon={weatherIcon(w?.state)} accent={C.cyan} delay={delay} className={className} right={<span className="text-[11px] text-dx-dim">{weatherLabel(w?.state)}</span>}>
      <div className="flex gap-5">
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-2 text-dx-cyan">
            {createElement(weatherIcon(w?.state), { size: 30, strokeWidth: 1.4, className: "dx-glow-cyan" })}
            <Big value={a.temperature === undefined ? "—" : Math.round(a.temperature as number)} unit="°" size={46} />
          </div>
          <div className="dx-num text-[11px] text-dx-dim">
            H {week[0]?.temperature !== undefined ? Math.round(week[0].temperature) : "—"}° · L {week[0]?.templow !== undefined ? Math.round(week[0].templow) : "—"}°
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-4">
          <KV k="Feels" v={a.apparent_temperature !== undefined ? `${Math.round(a.apparent_temperature as number)}°` : "—"} />
          <KV k="Humidity" v={a.humidity !== undefined ? `${a.humidity}%` : "—"} />
          <KV k="Wind" v={a.wind_speed !== undefined ? `${Math.round(a.wind_speed as number)} ${compass(a.wind_bearing as number | undefined)}` : "—"} />
          <KV k="UV" v={a.uv_index !== undefined ? String(a.uv_index) : "—"} />
          <KV k="Sunrise" v={t(sun?.attributes.next_rising)} />
          <KV k="Sunset" v={t(sun?.attributes.next_setting)} />
        </div>
      </div>

      {next.length > 0 && (
        <div className="mt-3">
          <Label className="mb-1">Next 12 h</Label>
          <BarChart
            height={64}
            from={C.violet}
            to={C.cyan}
            format={(v) => `${Math.round(v)}°`}
            baseline={Math.min(...next.map((f) => f.temperature ?? 0)) - 4}
            bars={next.map((f) => ({
              label: new Date(f.datetime).toLocaleTimeString(undefined, { hour: "numeric" }).replace(" ", "").toLowerCase(),
              value: f.temperature ?? 0,
              sub: f.precipitation_probability ? `${f.precipitation_probability}%☂` : undefined,
            }))}
          />
        </div>
      )}

      {week.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {week.map((d, i) => {
            const l = d.templow ?? d.temperature ?? 0;
            const h = d.temperature ?? l;
            const span = hi - lo || 1;
            return (
              <div key={d.datetime} className="flex items-center gap-2.5 text-[11.5px]">
                <span className="w-9 text-[10px] font-semibold uppercase tracking-[0.1em] text-dx-dim">
                  {i === 0 ? "Tod" : new Date(d.datetime).toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                {createElement(weatherIcon(d.condition), { size: 13, className: "text-dx-dim" })}
                <span className="dx-num w-7 text-right text-dx-dim">{Math.round(l)}°</span>
                <div className="relative h-[4px] flex-1 rounded-full bg-white/[0.05]">
                  <div
                    className="absolute h-full rounded-full"
                    style={{
                      left: `${((l - lo) / span) * 100}%`,
                      right: `${100 - ((h - lo) / span) * 100}%`,
                      background: `linear-gradient(90deg, ${C.cyan}, ${C.pink})`,
                      boxShadow: `0 0 6px ${C.violet}`,
                    }}
                  />
                </div>
                <span className="dx-num w-7 text-dx-text">{Math.round(h)}°</span>
                <span className="dx-num w-8 text-right text-[10px] text-dx-cyan">{d.precipitation_probability ? `${d.precipitation_probability}%` : ""}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- Cameras */

function useSignedSnapshot(entityId: string, everyMs: number) {
  const { signPath } = useHa();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    function load() {
      signPath(`/api/camera_proxy/${entityId}`, 60)
        .then((url) => !cancelled && setSrc(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`))
        .catch(() => {});
    }
    load();
    const timer = setInterval(load, everyMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [entityId, everyMs, signPath]);
  return src;
}

/** Live MJPEG for the full-screen view. */
function CameraLive({ entityId, label, onClose }: { entityId: string; label: string; onClose: () => void }) {
  const { signPath } = useHa();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    signPath(`/api/camera_proxy_stream/${entityId}`, 600).then(setSrc).catch(() => {});
  }, [entityId, signPath]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-label={label} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-10" onClick={onClose}>
      <div className="relative max-h-full w-full max-w-[1600px] overflow-hidden rounded-lg border border-white/10" onClick={(e) => e.stopPropagation()}>
        {src ? <img src={src} alt={label} className="w-full bg-black object-contain" /> : <div className="aspect-video animate-pulse bg-white/5" />}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded bg-black/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
          <Dot color={C.red} pulse /> Live · {label}
        </div>
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded bg-black/60 p-1.5 text-white hover:bg-black/80">
          <X size={16} />
        </button>
      </div>
    </div>,
    document.querySelector("[data-sheet-root]") ?? document.body,
  );
}

export function CameraTile({ entityId, label, everyMs = 4000, className }: { entityId: string; label: string; everyMs?: number; className?: string }) {
  const src = useSignedSnapshot(entityId, everyMs);
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState(false);
  const now = useNow(1000);
  return (
    <>
      <button
        onClick={() => setLive(true)}
        className={clsx("group relative overflow-hidden rounded-md border border-dx-line bg-black text-left", className ?? "aspect-video")}
      >
        {src && !failed ? (
          <img src={src} alt={label} onError={() => setFailed(true)} onLoad={() => setFailed(false)} className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
        ) : (
          <div className="dx-grid absolute inset-0 flex items-center justify-center text-dx-faint">
            <Cctv size={22} />
          </div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(transparent_60%,rgba(0,0,0,0.7))]" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
          <span className="flex items-center gap-1.5 rounded-sm bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
            <Dot color={failed ? C.faint : C.red} /> {label}
          </span>
          <Maximize2 size={13} className="text-white/0 transition-colors group-hover:text-white/80" />
        </div>
        <span className="dx-num absolute bottom-1.5 right-2 text-[10px] text-white/70">{now.toLocaleTimeString(undefined, { hour12: false })}</span>
      </button>
      {live && <CameraLive entityId={entityId} label={label} onClose={() => setLive(false)} />}
    </>
  );
}

/* ------------------------------------------------------- Event stream */

interface StreamEvent {
  t: number;
  tag: string;
  color: string;
  text: string;
}

export function EventStream({ delay = 0, className, hours = 24 }: { delay?: number; className?: string; hours?: number }) {
  const now = useNow(60_000);
  const { all } = useOpenings();
  const history = useStateHistory(all.map((d) => d.entityId), hours, { refreshMs: 60_000 });
  const camera = useCameraEvents(now);
  const events: StreamEvent[] = [];
  for (const d of all) {
    const pts = history?.[d.entityId] ?? [];
    pts.forEach((p, i) => {
      if (i === 0 || (p.state !== "on" && p.state !== "off")) return;
      events.push({
        t: p.t,
        tag: d.kind === "door" ? "DOOR" : "WIN",
        color: p.state === "on" ? C.amber : C.green,
        text: `${d.label} ${p.state === "on" ? "opened" : "closed"}`,
      });
    });
  }
  for (const e of camera ?? []) {
    const info = typeInfo(e.type);
    events.push({ t: e.t, tag: info.label.toUpperCase().slice(0, 6), color: e.type === "ring" ? C.pink : e.type === "person" ? C.violet : C.cyan, text: e.source.label });
  }
  events.sort((a, b) => b.t - a.t);

  return (
    <Panel title="Event stream" icon={Activity} accent={C.violet} delay={delay} className={className} bodyClassName="p-0" right={<span className="dx-num text-[10.5px] text-dx-faint">{events.length} / {hours}h</span>}>
      <div className="dx-scroll h-full overflow-y-auto px-4 py-2">
        {!history && !camera ? (
          <div className="h-40 animate-pulse rounded bg-white/[0.03]" />
        ) : events.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-dx-dim">Quiet. No events in {hours} hours.</div>
        ) : (
          events.slice(0, 120).map((e, i) => (
            <div key={`${e.t}-${i}`} className="flex items-center gap-2.5 border-b border-dashed border-dx-line py-[6px] text-[12px] last:border-0">
              <span className="dx-num w-[38px] shrink-0 text-[11px] text-dx-faint">{clock(e.t)}</span>
              <span className="w-[54px] shrink-0 rounded-sm border px-1 text-center text-[9px] font-bold tracking-[0.1em]" style={{ color: e.color, borderColor: `${e.color}55`, background: `${e.color}10` }}>
                {e.tag}
              </span>
              <span className="truncate text-dx-text">{e.text}</span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------- Openings timeline */

export function OpeningsTimeline({ hours = 24, delay = 0, className }: { hours?: number; delay?: number; className?: string }) {
  const now = useNow(60_000).getTime();
  const { all } = useOpenings();
  const history = useStateHistory(all.map((d) => d.entityId), hours, { refreshMs: 60_000 });
  const start = now - hours * 3600_000;
  return (
    <Panel title={`Openings · ${hours}h`} icon={DoorOpen} accent={C.amber} delay={delay} className={className}>
      {!history ? (
        <div className="h-32 animate-pulse rounded bg-white/[0.03]" />
      ) : (
        <Timeline
          hours={hours}
          start={start}
          end={now}
          rows={all.map((d) => {
            const s = spans(history[d.entityId], (x) => x === "on", start, now);
            return { label: d.label, spans: s, color: d.kind === "door" ? C.amber : C.pink, right: `${s.length}×` };
          })}
        />
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- Systems */

export function SystemsPanel({ delay = 0, className }: { delay?: number; className?: string }) {
  const { entities } = useHa();
  const now = useNow(60_000);
  return (
    <Panel title="Compute" icon={Monitor} accent={C.green} delay={delay} className={className}>
      <div className="grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-4">
        {CURATED_COMPUTERS.map((c, i) => {
          const online = computerOnline(c, entities);
          const m = c.meters[0];
          const e = entities[m?.entityId ?? ""];
          const raw = m?.attribute ? parseFloat(String(e?.attributes[m.attribute])) : num(e);
          const v = raw === null || !Number.isFinite(raw) ? null : m?.invert ? 100 - raw : raw;
          const boot = c.facts.find((f) => f.format === "since");
          const bootT = boot ? new Date(entities[boot.entityId]?.state ?? "").getTime() : NaN;
          return (
            <div key={c.key} className={clsx(!online && !c.activity && "opacity-40")}>
              <Ring
                value={online || c.activity ? v : null}
                label={c.name}
                sub={online ? (Number.isFinite(bootT) ? `up ${dur(now.getTime() - bootT)}` : `${m?.label ?? ""}`) : c.activity ? c.activity.off.toLowerCase() : "offline"}
                color={[C.cyan, C.pink, C.violet, C.green][i % 4]}
                size={80}
              />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- Health */

export function HealthPanel({ delay = 0, className }: { delay?: number; className?: string }) {
  const { entities } = useHa();
  const { updates, low } = useIssues();
  const alarm = entities[DESKTOP_ALARM];
  const tripped = DESKTOP_SAFETY.filter((s) => entities[s.entityId]?.state === "on");
  const vac = entities[`vacuum.${CURATED_VACUUM.prefix}`];
  const vacBat = num(entities[`sensor.${CURATED_VACUUM.prefix}_battery`]);

  return (
    <Panel title="Systems health" icon={HeartPulse} accent={C.green} delay={delay} className={className}>
      {alarm && <KV k="Alarm" dot={alarm.state === "triggered" ? C.red : alarm.state.startsWith("armed") ? C.green : C.faint} v={alarm.state.replace(/_/g, " ").toUpperCase()} />}
      <KV k="Smoke / CO" dot={tripped.length ? C.red : C.green} v={tripped.length ? tripped.map((t) => t.label).join(", ") : "CLEAR"} color={tripped.length ? C.red : undefined} />
      {DESKTOP_APPLIANCES.map((a) => {
        const e = entities[a.entityId];
        if (!e) return null;
        if (a.kind === "problem") {
          const bad = e.state === "on";
          return <KV key={a.entityId} k={a.label} dot={bad ? C.amber : C.green} v={bad ? "REPLACE" : "OK"} color={bad ? C.amber : undefined} />;
        }
        const unit = (e.attributes.unit_of_measurement as string | undefined) ?? "";
        return <KV key={a.entityId} k={a.label} v={isLive(e) ? `${a.kind === "temp" ? Math.round(parseFloat(e.state)) : e.state}${unit}` : "—"} />;
      })}
      {vac && <KV k={CURATED_VACUUM.name} v={`${vac.state.replace(/_/g, " ")}${vacBat !== null ? ` · ${Math.round(vacBat)}%` : ""}`} />}
      <KV k="Firmware" dot={updates.length ? C.amber : C.green} v={updates.length ? `${updates.length} pending` : "CURRENT"} color={updates.length ? C.amber : undefined} />
      <KV
        k={low.length ? `Low: ${low.map((b) => (b.e.attributes.friendly_name as string | undefined)?.replace(/ battery( level)?$/i, "") ?? b.e.entity_id).join(", ")}` : "Batteries"}
        dot={low.length ? C.amber : C.green}
        v={low.length ? `${low.length} LOW` : "OK"}
        color={low.length ? C.amber : undefined}
      />
    </Panel>
  );
}
