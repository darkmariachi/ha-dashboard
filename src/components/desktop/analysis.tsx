import { createElement, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { BarChart3, Cctv, Droplets, HardDrive, House, Lightbulb, Moon, Power, X } from "lucide-react";
import type { CuratedComputer } from "../../config/computers";
import { HOUSEHOLD_PEOPLE } from "../../config/curatedHome";
import { DESKTOP_INDOOR } from "../../config/desktop";
import { INSIGHT_LIGHTS, INSIGHTS_REFRESH_MS } from "../../config/insights";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { DAYS, dayStarts, hm } from "../devices/screenTime";
import { SignedImg, snapshotPath, typeInfo, useCameraEvents, type CameraEvent } from "../home/ActivityFeed";
import { useEntityHistory } from "../home/useEntityHistory";
import { useStateHistory } from "../home/useStateHistory";
import { addSpan } from "../devices/screenTime";
import { BarChart, LineChart, Timeline } from "./charts";
import { clock, computerOnline, dur, fmtW, isLive, num, SENSE, senseDevices, spans } from "./data";
import { Big, Btn, C, Dot, HBar, KV, Label, Panel, Ring, Segmented } from "./ui";

/* --------------------------------------------------- Energy breakdown */

/** Daily totals from a sensor that resets at midnight: each day's max. */
function dailyMax(points: { state: string; t: number }[] | undefined, starts: number[]) {
  return starts.map((s, i) => {
    const end = starts[i + 1] ?? Infinity;
    const vals = (points ?? []).filter((p) => p.t >= s && p.t < end).map((p) => parseFloat(p.state)).filter(Number.isFinite);
    return vals.length ? Math.max(...vals) : 0;
  });
}

export function EnergyBreakdown({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const now = useNow(60_000);
  const starts = dayStarts(now);
  const hist = useStateHistory([`${SENSE}_daily_energy`, `${SENSE}_daily_production`], DAYS * 24 + 1, { refreshMs: INSIGHTS_REFRESH_MS });
  const used = dailyMax(hist?.[`${SENSE}_daily_energy`], starts);
  const made = dailyMax(hist?.[`${SENSE}_daily_production`], starts);
  const devices = senseDevices(entities);
  const total = num(entities[`${SENSE}_energy`]) ?? 0;
  const v = (k: string) => num(entities[`${SENSE}_${k}`]);
  const k = (x: number | null) => (x === null ? "—" : `${x.toFixed(1)} kWh`);
  const co2 = num(entities["sensor.electricity_maps_co2_intensity"]);
  const fossil = num(entities["sensor.electricity_maps_grid_fossil_fuel_percentage"]);
  const l1 = num(entities[`${SENSE}_l1_voltage`]);
  const l2 = num(entities[`${SENSE}_l2_voltage`]);
  const dayLabel = (s: number) => new Date(s).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase().slice(0, 3);

  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <Panel title="Consumption · 7 days" icon={BarChart3} accent={C.pink} delay={delay}>
        <BarChart height={130} format={(x) => `${x.toFixed(1)} kWh`} highlight={DAYS - 1} bars={used.map((u, i) => ({ label: dayLabel(starts[i]), value: u }))} />
        <Label className="mb-1 mt-4">Solar production</Label>
        <BarChart height={70} from={C.green} to={C.cyan} format={(x) => `${x.toFixed(1)} kWh`} bars={made.map((m, i) => ({ label: dayLabel(starts[i]), value: m }))} />
      </Panel>

      <Panel title="Ledger" icon={Power} accent={C.cyan} delay={delay + 40}>
        <div className="grid grid-cols-2 gap-x-5">
          <div>
            <Label className="mb-1">Today</Label>
            <KV k="Used" v={k(v("daily_energy"))} />
            <KV k="Solar" v={k(v("daily_production"))} color={C.cyan} />
            <KV k="From grid" v={k(v("daily_from_grid"))} />
            <KV k="To grid" v={k(v("daily_to_grid"))} color={C.green} />
          </div>
          <div>
            <Label className="mb-1">Month</Label>
            <KV k="Used" v={k(v("monthly_energy"))} />
            <KV k="Solar" v={k(v("monthly_production"))} color={C.cyan} />
            <KV k="From grid" v={k(v("monthly_from_grid"))} />
            <KV k="To grid" v={k(v("monthly_to_grid"))} color={C.green} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <Label>Grid CO₂</Label>
            <Big value={co2 === null ? "—" : Math.round(co2)} unit="g/kWh" size={20} />
          </div>
          <div>
            <Label>Fossil</Label>
            <Big value={fossil === null ? "—" : Math.round(fossil)} unit="%" size={20} />
          </div>
          <div>
            <Label>Voltage</Label>
            <Big value={l1 === null ? "—" : `${Math.round(l1)}/${l2 === null ? "—" : Math.round(l2)}`} unit="V" size={20} />
          </div>
        </div>
      </Panel>

      <Panel title="Loads by appliance" icon={Power} accent={C.violet} delay={delay + 80} bodyClassName="dx-scroll max-h-[340px] overflow-y-auto">
        {devices.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-dx-dim">Sense hasn't identified any appliances.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {devices.map((d) => (
              <HBar
                key={d.name}
                label={d.name}
                value={d.power}
                max={Math.max(total, devices[0].power)}
                display={fmtW(d.power)}
                sub={d.today !== null ? `${d.today.toFixed(1)}kWh` : undefined}
                color={d.power >= 5 ? C.violet : C.faint}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------- Indoor air */

export function IndoorPanel({ delay = 0, className }: { delay?: number; className?: string }) {
  const temp = useEntityHistory(DESKTOP_INDOOR.temperature, 24, 96);
  const rh = useEntityHistory(DESKTOP_INDOOR.humidity, 24, 96);
  return (
    <Panel title="Indoor air · 24h" icon={Droplets} accent={C.violet} delay={delay} className={className}>
      <Label className="mb-1">Temperature</Label>
      <LineChart hours={24} height={110} format={(v) => `${v.toFixed(1)}°`} series={temp ? [{ label: "Temp", values: temp, color: C.violet, fill: true }] : []} />
      <Label className="mb-1 mt-3">Humidity</Label>
      <LineChart hours={24} height={80} format={(v) => `${Math.round(v)}%`} series={rh ? [{ label: "RH", values: rh, color: C.cyan, fill: true }] : []} />
    </Panel>
  );
}

/* ----------------------------------------------------------- Computers */

function meterValue(m: { entityId: string; attribute?: string; invert?: boolean }, entities: ReturnType<typeof useHa>["entities"]) {
  const e = entities[m.entityId];
  const raw = m.attribute ? parseFloat(String(e?.attributes[m.attribute])) : num(e);
  if (raw === null || !Number.isFinite(raw)) return null;
  return m.invert ? 100 - raw : raw;
}

export function ComputerPanel({ computer: c, index }: { computer: CuratedComputer; index: number }) {
  const { entities, callService } = useHa();
  const now = useNow(30_000);
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const online = computerOnline(c, entities);
  const live = online || !!c.activity;
  const colors = [C.cyan, C.pink, C.violet, C.green];
  const anything = [c.onlineEntity, ...c.meters.map((m) => m.entityId)].some((id) => entities[id]);
  const idle = c.idle && entities[c.idle.entityId]?.state === "on";

  function fact(f: CuratedComputer["facts"][number]) {
    const e = entities[f.entityId];
    if (!isLive(e)) return "—";
    if (f.format === "value") return e!.state;
    const t = new Date(e!.state).getTime();
    if (!Number.isFinite(t)) return e!.state;
    return f.format === "since" ? dur(now.getTime() - t) : `${dur(now.getTime() - t)} ago`;
  }

  return (
    <Panel
      title={`${c.name} · ${c.subtitle}`}
      icon={c.icon}
      accent={colors[index % 4]}
      delay={index * 40}
      right={
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: online ? (idle ? C.amber : C.green) : C.faint }}>
          <Dot color={online ? (idle ? C.amber : C.green) : C.faint} pulse={online && !idle} />
          {online ? (c.activity ? c.activity.on : idle ? "Idle" : "Online") : c.activity ? c.activity.off : "Offline"}
        </span>
      }
    >
      {!anything ? (
        <div className="py-4 text-[12px] text-dx-dim">{c.setupHint}</div>
      ) : (
        <div className="flex gap-5">
          <div className={clsx("flex gap-3", !live && "opacity-35")}>
            {c.meters.slice(0, 3).map((m, i) => (
              <Ring key={m.entityId} value={live ? meterValue(m, entities) : null} label={m.label} color={m.lowIsBad ? C.green : colors[(index + i) % 4]} size={78} />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            {c.facts.map((f) => (
              <KV key={f.label} k={f.label} v={fact(f)} />
            ))}
            {c.badges
              ?.filter((b) => entities[b.entityId]?.state === "on")
              .map((b) => <KV key={b.entityId} k={b.label} dot={C.red} v="ACTIVE" color={C.red} />)}
          </div>
        </div>
      )}
      {c.disks && c.disks.some((d) => entities[d.entityId]) && (
        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2.5">
          {c.disks
            .filter((d) => entities[d.entityId])
            .map((d) => {
              const v = meterValue(d, entities);
              return (
                <HBar
                  key={d.entityId}
                  label={
                    <span className="flex items-center gap-1.5">
                      <HardDrive size={11} className="text-dx-dim" />
                      {d.label}
                    </span>
                  }
                  value={v ?? 0}
                  max={100}
                  display={v === null ? "—" : `${Math.round(v)}%`}
                  color={v !== null && v >= 90 ? C.red : v !== null && v >= 80 ? C.amber : C.cyan}
                />
              );
            })}
        </div>
      )}
      {c.actions && c.actions.length > 0 && (
        <div className="mt-4 flex gap-1.5">
          {c.actions
            .filter((a) => (a.when === "online") === online)
            .map((a) => {
              const Icon = a.icon ?? (a.when === "offline" ? Power : Moon);
              const confirming = armed === a.label;
              return (
                <Btn
                  key={a.label}
                  color={confirming ? C.amber : a.when === "offline" ? C.green : undefined}
                  onClick={() => {
                    if (a.confirm && !confirming) return setArmed(a.label);
                    setArmed(null);
                    callService(a.domain, a.service, {}, { entity_id: a.entityId }).catch(() => {});
                  }}
                >
                  <Icon size={12} /> {confirming ? `Confirm ${a.label.toLowerCase()}` : a.label}
                </Btn>
              );
            })}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------ Presence */

export function PresencePanel({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const now = useNow(60_000).getTime();
  const people = HOUSEHOLD_PEOPLE.filter((id) => entities[id]);
  const history = useStateHistory(people, DAYS * 24, { refreshMs: INSIGHTS_REFRESH_MS });
  const start = now - DAYS * 86400_000;
  const starts = dayStarts(new Date(now));
  const colors = [C.cyan, C.pink, C.violet, C.green];
  return (
    <Panel title="Presence · 7 days" icon={House} accent={C.cyan} delay={delay}>
      {!history ? (
        <div className="h-24 animate-pulse rounded bg-white/[0.03]" />
      ) : (
        <>
          <Timeline
            hours={DAYS * 24}
            start={start}
            end={now}
            rows={people.map((id, i) => {
              const s = spans(history[id], (x) => x === "home", start, now);
              const total = s.reduce((n, x) => n + (x.end - x.start), 0);
              return {
                label: ((entities[id].attributes.friendly_name as string | undefined) ?? id).split(" ")[0],
                spans: s,
                color: colors[i % 4],
                right: `${Math.round((total / (now - start)) * 100)}%`,
              };
            })}
          />
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {people.map((id, i) => {
              const days = new Array<number>(DAYS).fill(0);
              for (const s of spans(history[id], (x) => x === "home", starts[0], now)) addSpan(days, s.start, s.end, starts, now);
              return (
                <div key={id}>
                  <Label className="mb-1">{((entities[id].attributes.friendly_name as string | undefined) ?? id).split(" ")[0]} · hours home</Label>
                  <BarChart
                    height={90}
                    from={`${colors[i % 4]}55`}
                    to={colors[i % 4]}
                    highlight={undefined}
                    format={(m) => hm(m)}
                    bars={days.map((m, d) => ({ label: new Date(starts[d]).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase().slice(0, 3), value: m }))}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {people.map((id, i) => {
              const p = entities[id];
              return (
                <div key={id} className="flex items-center gap-2 text-[12px]">
                  <Dot color={p.state === "home" ? colors[i % 4] : C.faint} pulse={p.state === "home"} />
                  <span className="text-dx-text">{((p.attributes.friendly_name as string | undefined) ?? id).split(" ")[0]}</span>
                  <span className="dx-num ml-auto text-dx-dim">
                    {p.state === "home" ? "home" : p.state === "not_home" ? "away" : p.state} · {dur(now - new Date(p.last_changed).getTime())}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- Lights */

export function LightsPanel({ delay = 0 }: { delay?: number }) {
  const now = useNow(60_000);
  const t = now.getTime();
  const starts = dayStarts(now);
  const history = useStateHistory(INSIGHT_LIGHTS.map((l) => l.entityId), DAYS * 24, { refreshMs: INSIGHTS_REFRESH_MS });
  const [range, setRange] = useState<"today" | "week">("week");
  const from = range === "today" ? starts[DAYS - 1] : starts[0];
  const rows = INSIGHT_LIGHTS.map((l) => {
    const s = spans(history?.[l.entityId], (x) => x === "on", from, t);
    return { ...l, mins: s.reduce((n, x) => n + (x.end - x.start), 0) / 60000 };
  })
    .filter((r) => r.mins > 0)
    .sort((a, b) => b.mins - a.mins);
  const perDay = new Array<number>(DAYS).fill(0);
  for (const l of INSIGHT_LIGHTS) {
    for (const s of spans(history?.[l.entityId], (x) => x === "on", starts[0], t)) addSpan(perDay, s.start, s.end, starts, t);
  }

  return (
    <Panel
      title="Lighting hours"
      icon={Lightbulb}
      accent={C.amber}
      delay={delay}
      right={
        <div className="w-[130px]">
          <Segmented value={range} onChange={setRange} options={[{ value: "today", label: "Today" }, { value: "week", label: "7 days" }]} />
        </div>
      }
    >
      {!history ? (
        <div className="h-40 animate-pulse rounded bg-white/[0.03]" />
      ) : (
        <>
          <BarChart
            height={90}
            from={C.amber}
            to={C.pink}
            highlight={DAYS - 1}
            format={(m) => hm(m)}
            bars={perDay.map((m, i) => ({ label: new Date(starts[i]).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase().slice(0, 3), value: m }))}
          />
          <div className="dx-scroll mt-4 flex max-h-[360px] flex-col gap-2.5 overflow-y-auto pr-1">
            {rows.length === 0 && <div className="text-[12px] text-dx-dim">No lights on in this period.</div>}
            {rows.map((r) => (
              <HBar key={r.entityId} label={`${r.room} · ${r.label}`} value={r.mins} max={rows[0].mins} display={hm(r.mins)} color={C.amber} />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------- Detections */

const FILTERS = [
  { value: "all", label: "All", types: null },
  { value: "people", label: "People", types: ["person", "ring"] },
  { value: "vehicles", label: "Vehicles", types: ["vehicle"] },
  { value: "other", label: "Other", types: ["animal", "motion", "package"] },
] as const;

function Lightbox({ event, onClose }: { event: CameraEvent; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const info = typeInfo(event.type);
  return createPortal(
    <div role="dialog" aria-label={info.label} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-10" onClick={onClose}>
      <div className="relative w-full max-w-[1280px] overflow-hidden rounded-lg border border-white/10" onClick={(e) => e.stopPropagation()}>
        <SignedImg path={snapshotPath(event, 1280)} className="aspect-video w-full" />
        <div className="absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
          {info.label} · {event.source.label} · {new Date(event.t).toLocaleString()}
        </div>
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded bg-black/60 p-1.5 text-white hover:bg-black/80">
          <X size={16} />
        </button>
      </div>
    </div>,
    document.querySelector("[data-sheet-root]") ?? document.body,
  );
}

export function DetectionsPanel({ delay = 0, className }: { delay?: number; className?: string }) {
  const now = useNow(60_000);
  const events = useCameraEvents(now);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [open, setOpen] = useState<CameraEvent | null>(null);
  const types = FILTERS.find((f) => f.value === filter)?.types;
  const shown = (events ?? []).filter((e) => !types || (types as readonly string[]).includes(e.type)).slice(0, 48);
  const counts = new Map<string, number>();
  for (const e of events ?? []) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  return (
    <Panel
      title="Detections · 24h"
      icon={Cctv}
      accent={C.pink}
      delay={delay}
      className={className}
      right={
        <div className="w-[280px]">
          <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-4">
        {[...counts].map(([type, n]) => {
          const info = typeInfo(type);
          return (
            <span key={type} className="flex items-center gap-1.5 text-[11px] text-dx-dim">
              {createElement(info.icon, { size: 12 })}
              {info.label}
              <b className="dx-num text-dx-text">{n}</b>
            </span>
          );
        })}
      </div>
      {!events ? (
        <div className="h-40 animate-pulse rounded bg-white/[0.03]" />
      ) : shown.length === 0 ? (
        <div className="py-6 text-center text-[12px] text-dx-dim">Nothing detected.</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 2xl:grid-cols-6">
          {shown.map((e) => {
            const info = typeInfo(e.type);
            return (
              <button key={e.id} onClick={() => setOpen(e)} className="group overflow-hidden rounded-md border border-dx-line bg-black text-left hover:border-white/20">
                <div className="relative">
                  <SignedImg path={snapshotPath(e, 320)} className="aspect-video w-full opacity-85 group-hover:opacity-100" />
                  <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-sm bg-black/65 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-white">
                    {createElement(info.icon, { size: 10 })} {info.label}
                  </span>
                </div>
                <div className="flex items-center justify-between px-2 py-1 text-[10.5px]">
                  <span className="truncate text-dx-dim">{e.source.label}</span>
                  <span className="dx-num text-dx-faint">{clock(e.t)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {open && <Lightbox event={open} onClose={() => setOpen(null)} />}
    </Panel>
  );
}

