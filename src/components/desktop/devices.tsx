import { useEffect, useState } from "react";
import clsx from "clsx";
import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import { Bell, BellOff, Boxes, Cpu, Globe, HardDrive, Loader2, Moon, Power, Server, TvMinimalPlay, Wifi } from "lucide-react";
import { CURATED_COMPUTERS, type ComputerMeter, type CuratedComputer } from "../../config/computers";
import { HOUSEHOLD_PEOPLE } from "../../config/curatedHome";
import { DESKTOP_NETWORK, DESKTOP_SERVER } from "../../config/desktop";
import { YOUTUBE } from "../../config/youtube";
import { useHa } from "../../ha/HaProvider";
import { currentSubscription, disablePush, enablePush, pushSupport, sendTestPush } from "../../lib/push";
import { useNow } from "../../lib/useNow";
import { DAYS, addSpan, dayStarts, hm, mondayStart } from "../devices/screenTime";
import { useEntityHistory } from "../home/useEntityHistory";
import { useStateHistory, type StatePoint } from "../home/useStateHistory";
import { LineChart, StackedBars } from "./charts";
import { computerOnline, dur, fmtMbps, isLive, num, rateOf, throughputSource, toMbps } from "./data";
import { Big, Btn, C, Dot, HBar, KV, Label, Panel, Ring, Segmented } from "./ui";

const HOST_COLORS = [C.cyan, C.pink, C.violet, C.green];

/* ------------------------------------------------------------- helpers */

function meterValue(m: ComputerMeter | undefined, entities: HassEntities) {
  if (!m) return null;
  const e = entities[m.entityId];
  const raw = m.attribute ? parseFloat(String(e?.attributes[m.attribute])) : num(e);
  if (raw === null || !Number.isFinite(raw)) return null;
  return m.invert ? 100 - raw : raw;
}

function unitOf(e: HassEntity | undefined) {
  return (e?.attributes.unit_of_measurement as string | undefined) ?? "";
}

/** A temperature as 0–100 of a sensible range, and a warning color. */
function tempScale(v: number, unit: string) {
  const c = unit === "°F" ? ((v - 32) * 5) / 9 : v;
  return { pct: Math.min(100, Math.max(0, (c / 100) * 100)), color: c >= 85 ? C.red : c >= 72 ? C.amber : C.green };
}

function usageColor(v: number | null) {
  return v === null ? C.faint : v >= 92 ? C.red : v >= 80 ? C.amber : C.cyan;
}

/** Inline meter: thin bar + mono value, for table cells. */
function Cell({ value, text, color }: { value: number | null; text?: string; color?: string }) {
  const c = color ?? usageColor(value);
  return (
    <div className="flex items-center gap-2">
      <div className="h-[5px] w-20 overflow-hidden rounded-sm bg-white/[0.05]">
        <div className="h-full rounded-sm" style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%`, background: c, boxShadow: `0 0 6px ${c}` }} />
      </div>
      <span className="dx-num w-12 text-[11.5px]" style={{ color: value === null ? C.faint : C.text }}>
        {text ?? (value === null ? "—" : `${Math.round(value)}%`)}
      </span>
    </div>
  );
}

/** When a host was last online: the end of its last live stretch in the
 * past week (last_changed resets on every HA restart, so history it is). */
function useOfflineSince(c: CuratedComputer, online: boolean) {
  const ids = c.activity ? [c.activity.entityId] : [c.onlineEntity];
  const history = useStateHistory(online ? [] : ids, 7 * 24);
  if (online || !history) return undefined;
  const pts = history[ids[0]] ?? [];
  const good = (s: string) => (c.activity ? s === "on" : s !== "unavailable" && s !== "unknown");
  for (let i = pts.length - 1; i >= 0; i--) if (good(pts[i].state)) return pts[i + 1]?.t ?? null;
  return null;
}

/* ---------------------------------------------------------- Fleet table */

function FleetRow({ c, index }: { c: CuratedComputer; index: number }) {
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
  const offlineSince = useOfflineSince(c, online);
  const idle = c.idle && entities[c.idle.entityId]?.state === "on";
  const cpu = c.meters.find((m) => m.label === "CPU");
  const mem = c.meters.find((m) => m.label === "Memory");
  const battery = c.meters.find((m) => m.lowIsBad);
  const tempM = c.meters.find((m) => /temp/i.test(m.label));
  const boot = c.facts.find((f) => f.format === "since");
  const bootT = boot ? new Date(entities[boot.entityId]?.state ?? "").getTime() : NaN;
  const lastActive = c.idle ? new Date(entities[c.idle.lastActiveEntity]?.state ?? "").getTime() : NaN;
  const temp = tempM ? num(entities[tempM.entityId]) : null;
  const tUnit = tempM ? unitOf(entities[tempM.entityId]) : "";
  const statusColor = online ? (idle ? C.amber : C.green) : C.faint;

  return (
    <tr className="border-b border-dashed border-dx-line text-[12px] last:border-0 hover:bg-white/[0.015]">
      <td className="py-2.5 pl-1 pr-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border" style={{ borderColor: `${HOST_COLORS[index % 4]}55`, color: HOST_COLORS[index % 4] }}>
            <c.icon size={14} />
          </span>
          <div>
            <div className="font-semibold text-dx-text">{c.name}</div>
            <div className="text-[10.5px] text-dx-faint">{c.subtitle}</div>
          </div>
        </div>
      </td>
      <td className="px-3">
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: statusColor }}>
          <Dot color={statusColor} pulse={online && !idle} />
          {online ? (c.activity ? c.activity.on : idle ? "Idle" : "Online") : c.activity ? c.activity.off : "Offline"}
        </span>
      </td>
      <td className="dx-num px-3 text-dx-dim">
        {online && Number.isFinite(bootT)
          ? dur(now.getTime() - bootT)
          : !online && offlineSince
            ? <span title={new Date(offlineSince).toLocaleString()}>off {dur(now.getTime() - offlineSince)}</span>
            : "—"}
      </td>
      <td className="px-3">{cpu ? <Cell value={live ? meterValue(cpu, entities) : null} /> : <span className="text-dx-faint">—</span>}</td>
      <td className="px-3">{mem ? <Cell value={live ? meterValue(mem, entities) : null} /> : <span className="text-dx-faint">—</span>}</td>
      <td className="px-3">
        {battery ? (
          <Cell value={meterValue(battery, entities)} color={(meterValue(battery, entities) ?? 100) <= 20 ? C.red : C.green} />
        ) : tempM && temp !== null && live ? (
          <Cell value={tempScale(temp, tUnit).pct} text={`${Math.round(temp)}${tUnit}`} color={tempScale(temp, tUnit).color} />
        ) : (
          <span className="text-dx-faint">—</span>
        )}
      </td>
      <td className="dx-num px-3 text-dx-dim">{Number.isFinite(lastActive) ? `${dur(now.getTime() - lastActive)} ago` : "—"}</td>
      <td className="py-2 pl-3 pr-1 text-right">
        <div className="flex justify-end gap-1.5">
          {(c.actions ?? [])
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
                  <Icon size={11} /> {confirming ? `Confirm` : a.label}
                </Btn>
              );
            })}
        </div>
      </td>
    </tr>
  );
}

export function FleetTable({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const up = CURATED_COMPUTERS.filter((c) => computerOnline(c, entities)).length;
  return (
    <Panel title="Fleet" icon={Cpu} accent={C.cyan} delay={delay} right={<span className="dx-num text-[10.5px] text-dx-dim">{up}/{CURATED_COMPUTERS.length} up</span>}>
      <table className="w-full">
        <thead>
          <tr className="text-left text-[9.5px] font-semibold uppercase tracking-[0.14em] text-dx-faint">
            <th className="pb-2 pl-1 pr-3 font-semibold">Host</th>
            <th className="px-3 pb-2 font-semibold">Status</th>
            <th className="px-3 pb-2 font-semibold">Uptime</th>
            <th className="px-3 pb-2 font-semibold">CPU</th>
            <th className="px-3 pb-2 font-semibold">Memory</th>
            <th className="px-3 pb-2 font-semibold">Temp / Batt</th>
            <th className="px-3 pb-2 font-semibold">Last input</th>
            <th className="pb-2 pl-3 pr-1" />
          </tr>
        </thead>
        <tbody>
          {CURATED_COMPUTERS.map((c, i) => (
            <FleetRow key={c.key} c={c} index={i} />
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/* --------------------------------------------------------- Server panel */

export function ServerPanel({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const S = DESKTOP_SERVER;
  const [range, setRange] = useState<"6h" | "24h">("6h");
  const hours = range === "6h" ? 6 : 24;
  const cpuH = useEntityHistory(S.cpu, hours, 72);
  const memH = useEntityHistory(S.memory, hours, 72);
  const tempH = useEntityHistory(S.temps[0].entityId, hours, 72);
  const rxH = useEntityHistory(S.nic.rx, hours, 72);
  const txH = useEntityHistory(S.nic.tx, hours, 72);
  if (!entities[S.cpu]) return null;

  const v = (id: string) => num(entities[id]);
  const swap = v(S.swap);
  const temps = S.temps.filter((t) => num(entities[t.entityId]) !== null);
  const tUnit = unitOf(entities[S.temps[0].entityId]);
  const mib = (x: number | null) => (x === null ? "—" : x >= 1024 ? `${(x / 1024).toFixed(1)} GiB` : `${Math.round(x)} MiB`);
  const gib = (x: number | null) => (x === null ? "—" : x >= 1024 ? `${(x / 1024).toFixed(1)} TiB` : `${Math.round(x)} GiB`);

  return (
    <Panel
      title="skylab · home server"
      icon={Server}
      accent={C.violet}
      delay={delay}
      right={
        <div className="w-[110px]">
          <Segmented value={range} onChange={setRange} options={[{ value: "6h", label: "6h" }, { value: "24h", label: "24h" }]} />
        </div>
      }
    >
      <div className="grid gap-5 2xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
        {/* Gauges + counters */}
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Ring value={v(S.cpu)} label="CPU" color={C.cyan} size={84} sub={`load ${v(S.load)?.toFixed(2) ?? "—"}`} />
            <Ring value={v(S.memory)} label="Memory" color={C.pink} size={84} sub={mib(v(S.memoryUsed))} />
            <Ring value={v(S.gpu)} label="iGPU" color={C.violet} size={84} sub="Quick Sync" />
          </div>
          <div className="grid grid-cols-2 gap-x-5">
            <KV k="Containers" v={entities[S.containers]?.state ?? "—"} color={C.cyan} />
            <KV k="Ctr CPU" v={v(S.containersCpu) === null ? "—" : `${v(S.containersCpu)!.toFixed(1)}%`} />
            <KV k="Ctr memory" v={mib(v(S.containersMemory))} />
            <KV k="Swap" v={swap === null ? "—" : `${Math.round(swap)}%`} color={swap !== null && swap >= 90 ? C.amber : undefined} dot={swap !== null && swap >= 90 ? C.amber : undefined} />
            <KV k="Processes" v={entities[S.processes]?.state ?? "—"} />
            <KV k="Threads" v={entities[S.threads]?.state ?? "—"} />
          </div>
        </div>

        {/* Load + temperature */}
        <div className="flex min-w-0 flex-col gap-1">
          <Label>CPU / memory %</Label>
          <LineChart
            hours={hours}
            height={110}
            floor={0}
            format={(x) => `${Math.round(x)}%`}
            series={[
              ...(cpuH ? [{ label: "CPU", values: cpuH, color: C.cyan, fill: true }] : []),
              ...(memH ? [{ label: "Memory", values: memH, color: C.pink }] : []),
            ]}
          />
          <Label className="mt-2">LAN {S.nic.rx.split("_").at(-2)} · Mbit/s</Label>
          <LineChart
            hours={hours}
            height={80}
            floor={0}
            format={(x) => x.toFixed(1)}
            series={[
              ...(rxH ? [{ label: "RX", values: rxH, color: C.green, fill: true }] : []),
              ...(txH ? [{ label: "TX", values: txH, color: C.violet }] : []),
            ]}
          />
        </div>

        {/* Thermals, I/O, storage */}
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <Label className="mb-1.5">Thermals</Label>
            <div className="grid grid-cols-2 gap-x-5 gap-y-2">
              {temps.map((t) => {
                const x = num(entities[t.entityId]);
                const u = unitOf(entities[t.entityId]);
                const sc = x === null ? null : tempScale(x, u);
                return <HBar key={t.entityId} label={t.label} value={sc?.pct ?? 0} max={100} display={x === null ? "—" : `${Math.round(x)}${u}`} color={sc?.color ?? C.faint} />;
              })}
            </div>
            {tempH && (
              <div className="mt-2">
                <LineChart hours={hours} height={54} format={(x) => `${Math.round(x)}${tUnit}`} series={[{ label: "Package", values: tempH, color: C.amber, fill: true }]} />
              </div>
            )}
          </div>
          <div>
            <Label className="mb-1">Disk I/O · MB/s</Label>
            <div className="grid grid-cols-4 gap-2">
              {S.io
                .filter((d) => entities[`sensor.skylab_${d.dev}_disk_read`])
                .map((d) => {
                  const r = v(`sensor.skylab_${d.dev}_disk_read`);
                  const w = v(`sensor.skylab_${d.dev}_disk_write`);
                  return (
                    <div key={d.dev} className="rounded-md border border-dx-line bg-white/[0.015] px-2 py-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-dx-dim">{d.label}</div>
                      <div className="dx-num text-[11px] text-dx-green">R {r?.toFixed(2) ?? "—"}</div>
                      <div className="dx-num text-[11px] text-dx-violet">W {w?.toFixed(2) ?? "—"}</div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* Storage table */}
      <div className="mt-4 border-t border-dx-line pt-3">
        <div className="mb-2 flex items-center gap-2">
          <HardDrive size={13} className="text-dx-dim" />
          <Label>Storage</Label>
        </div>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 2xl:grid-cols-5">
          {S.mounts
            .filter((m) => entities[`sensor.skylab_${m.key}_disk_usage`])
            .map((m) => {
              const pct = v(`sensor.skylab_${m.key}_disk_usage`);
              const size = v(`sensor.skylab_${m.key}_disk_size`);
              const free = v(`sensor.skylab_${m.key}_disk_free`);
              return (
                <HBar
                  key={m.key}
                  label={m.label}
                  value={pct ?? 0}
                  max={100}
                  display={pct === null ? "—" : `${Math.round(pct)}%`}
                  sub={`${gib(free)} free / ${gib(size)}`}
                  color={usageColor(pct)}
                />
              );
            })}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------- Workstations */

export function WorkstationPanel({ c, index }: { c: CuratedComputer; index: number }) {
  const { entities } = useHa();
  const now = useNow(30_000);
  const online = computerOnline(c, entities);
  const live = online || !!c.activity;
  const cpu = c.meters[0];
  const mem = c.meters[1];
  const cpuH = useEntityHistory(cpu?.entityId ?? "", 6, 72);
  const memH = useEntityHistory(mem?.entityId ?? "", 6, 72);
  const offlineSince = useOfflineSince(c, online);
  const color = HOST_COLORS[index % 4];
  const badges = c.badges?.filter((b) => entities[b.entityId]?.state === "on") ?? [];

  function fact(f: CuratedComputer["facts"][number]) {
    const e = entities[f.entityId];
    if (!isLive(e)) return "—";
    if (f.format === "value") return e!.state;
    const t = new Date(e!.state).getTime();
    if (!Number.isFinite(t)) return e!.state;
    return f.format === "since" ? dur(now.getTime() - t) : `${dur(now.getTime() - t)} ago`;
  }

  const inv = (vals: number[] | null, m: ComputerMeter | undefined) => (vals && m?.invert ? vals.map((x) => 100 - x) : vals);

  return (
    <Panel title={`${c.name} · ${c.subtitle}`} icon={c.icon} accent={color} delay={index * 40}>
      {live ? (
        <LineChart
          hours={6}
          height={96}
          floor={0}
          format={(x) => `${Math.round(x)}%`}
          series={[
            ...(cpuH && cpu ? [{ label: cpu.label, values: inv(cpuH, cpu)!, color, fill: true }] : []),
            ...(memH && mem ? [{ label: mem.label, values: inv(memH, mem)!, color: C.violet }] : []),
          ]}
        />
      ) : (
        <div className="dx-grid flex h-[114px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-dx-line text-center">
          <Power size={18} className="text-dx-faint" />
          <div className="text-[11px] uppercase tracking-[0.14em] text-dx-dim">Offline</div>
          <div className="dx-num text-[11px] text-dx-faint">
            {offlineSince ? `since ${new Date(offlineSince).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} · ${dur(now.getTime() - offlineSince)}` : offlineSince === null ? "not seen this week" : "…"}
          </div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-x-5">
        {c.facts
          .filter((f) => live || fact(f) !== "—")
          .map((f) => (
            <KV key={f.label} k={f.label} v={fact(f)} />
          ))}
        {(c.disks ?? []).map((d) => {
          const x = meterValue(d, entities);
          if (x === null && !live) return null;
          return <KV key={d.entityId} k={`Disk ${d.label}`} v={x === null ? "—" : `${Math.round(x)}%`} color={x !== null && x >= 90 ? C.red : undefined} />;
        })}
        {badges.map((b) => (
          <KV key={b.entityId} k={b.label} dot={C.red} v="ACTIVE" color={C.red} />
        ))}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------- Network */

const BANDS: Record<string, { label: string; color: string }> = {
  ng: { label: "2.4 GHz", color: C.amber },
  na: { label: "5 GHz", color: C.cyan },
  "6e": { label: "6 GHz", color: C.violet },
};

export function NetworkConsole({ delay = 0 }: { delay?: number }) {
  const { entities, entitiesWithArea } = useHa();
  const [range, setRange] = useState<"6h" | "24h">("6h");
  const hours = range === "6h" ? 6 : 24;
  const wan = entities[DESKTOP_NETWORK.wan];
  const src = throughputSource(entities);
  const internet = src.kind !== "lan";
  // Only UPnP reports WAN up/down; the port sensors just carry traffic.
  const wanDown = src.kind === "upnp" && wan?.state === "off";
  const unit = (id: string) => entities[id]?.attributes.unit_of_measurement as string | undefined;
  const downH = useEntityHistory(src.down, hours, 72);
  const upH = useEntityHistory(src.up, hours, 72);
  const modem = entities[DESKTOP_NETWORK.modem];
  const statusColor = !internet ? C.dim : wanDown ? C.red : C.green;

  const clients = Object.values(entitiesWithArea).filter((e) => e.domain === "device_tracker" && e.platform === "unifi" && e.entity.state === "home");
  const wired = clients.filter((c) => c.entity.attributes.is_wired).length;
  const bands = new Map<string, number>();
  const ssids = new Map<string, number>();
  for (const c of clients) {
    if (c.entity.attributes.is_wired) continue;
    const r = (c.entity.attributes.radio as string | undefined) ?? "?";
    bands.set(r, (bands.get(r) ?? 0) + 1);
    const s = (c.entity.attributes.essid as string | undefined) ?? "—";
    ssids.set(s, (ssids.get(s) ?? 0) + 1);
  }
  const wireless = clients.length - wired;

  return (
    <Panel
      title="Network"
      icon={Globe}
      accent={C.cyan}
      delay={delay}
      right={
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: statusColor }}>
            <Dot color={internet ? statusColor : C.faint} pulse={internet && !wanDown} />
            {!internet ? "WAN stats offline" : wanDown ? "WAN down" : src.kind === "wan-port" ? "WAN · UDM port 9" : "WAN up"}
          </span>
          <div className="w-[110px]">
            <Segmented value={range} onChange={setRange} options={[{ value: "6h", label: "6h" }, { value: "24h", label: "24h" }]} />
          </div>
        </div>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="mb-2 flex items-start justify-between gap-4">
            <div className="grid grid-cols-3 gap-6">
              <div>
                <Label>{internet ? "↓ Internet" : "skylab ↓"}</Label>
                <Big value={fmtMbps(rateOf(entities, src.down))} unit="Mb/s" color={internet ? C.cyan : C.green} size={24} />
              </div>
              <div>
                <Label>{internet ? "↑ Internet" : "skylab ↑"}</Label>
                <Big value={fmtMbps(rateOf(entities, src.up))} unit="Mb/s" color={internet ? C.pink : C.violet} size={24} />
              </div>
              <div>
                <Label>Modem</Label>
                <Big value={modem?.state ?? "—"} size={18} color={modem?.state === "connected" ? C.green : undefined} />
              </div>
            </div>
            {!internet && (
              <p className="max-w-[300px] text-right text-[11px] leading-snug text-dx-faint">
                No internet throughput: UPnP is off on the UDM, and the UniFi integration's WAN port sensors (port 9) aren't reporting.
                Showing skylab's LAN port instead.
              </p>
            )}
          </div>
          <LineChart
            hours={hours}
            height={120}
            floor={0}
            format={(x) => fmtMbps(x)}
            series={[
              ...(downH ? [{ label: internet ? "Down" : "skylab RX", values: downH.map((x) => toMbps(x, unit(src.down))!), color: internet ? C.cyan : C.green, fill: true }] : []),
              ...(upH ? [{ label: internet ? "Up" : "skylab TX", values: upH.map((x) => toMbps(x, unit(src.up))!), color: internet ? C.pink : C.violet }] : []),
            ]}
          />
        </div>

        <div className="flex flex-col gap-3 border-dx-line xl:border-l xl:pl-5">
          <div className="flex items-end justify-between">
            <div>
              <Label>Clients online</Label>
              <Big value={clients.length} size={34} />
            </div>
            <div className="text-right text-[11px] text-dx-dim">
              <div className="dx-num">
                <Wifi size={11} className="mr-1 inline" />
                {wireless} wireless
              </div>
              {wired > 0 && <div className="dx-num">{wired} wired</div>}
            </div>
          </div>
          <div className="flex h-2 overflow-hidden rounded-sm">
            {[...bands].map(([r, n]) => (
              <span key={r} style={{ width: `${(n / Math.max(1, wireless)) * 100}%`, background: BANDS[r]?.color ?? C.faint }} title={`${BANDS[r]?.label ?? r}: ${n}`} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {[...bands]
              .sort((a, b) => b[1] - a[1])
              .map(([r, n]) => (
                <HBar key={r} label={BANDS[r]?.label ?? r} value={n} max={wireless} display={n} color={BANDS[r]?.color ?? C.faint} />
              ))}
          </div>
          {ssids.size > 0 && (
            <div>
              <Label className="mb-1">SSIDs</Label>
              {[...ssids].map(([s, n]) => (
                <KV key={s} k={s} v={n} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------- Screen time */

type Kind = "kids" | "youtube";
const YT = { kids: C.red, youtube: C.cyan };

function kindOf(state: string, attributes: Record<string, unknown> | undefined): Kind | undefined {
  if (YOUTUBE.offStates.includes(state)) return undefined;
  return YOUTUBE.apps[attributes?.app_id as string];
}

function daily(points: StatePoint[], starts: number[], now: number) {
  const t: Record<Kind, number[]> = { kids: new Array<number>(DAYS).fill(0), youtube: new Array<number>(DAYS).fill(0) };
  points.forEach((p, i) => {
    const k = kindOf(p.state, p.attributes);
    if (k) addSpan(t[k], Math.max(p.t, starts[0]), i + 1 < points.length ? points[i + 1].t : now, starts, now);
  });
  return t;
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

export function ScreenTimePanel({ delay = 0 }: { delay?: number }) {
  const { entities, entitiesWithArea } = useHa();
  const now = useNow(60_000);
  const players = Object.values(entitiesWithArea)
    .filter((e) => e.domain === "media_player" && e.platform === YOUTUBE.platform)
    .map((e) => e.entityId)
    .sort();
  const history = useStateHistory(players, DAYS * 24, { withAttributes: true, refreshMs: 5 * 60_000 });
  if (players.length === 0) return null;

  const starts = dayStarts(now);
  const monday = mondayStart(now);
  const perTv = players.map((id) => ({ id, name: entitiesWithArea[id].friendlyName, d: daily(history?.[id] ?? [], starts, now.getTime()) }));
  const days = {
    kids: starts.map((_, i) => sum(perTv.map((tv) => tv.d.kids[i]))),
    youtube: starts.map((_, i) => sum(perTv.map((tv) => tv.d.youtube[i]))),
  };
  const week = (v: number[]) => sum(v.filter((_, i) => starts[i] >= monday));
  const watching = players.flatMap((id) => {
    const k = kindOf(entities[id].state, entities[id].attributes);
    return k ? [{ id, k, name: entitiesWithArea[id].friendlyName }] : [];
  });
  const tvs = perTv
    .map((tv) => ({ ...tv, total: week(tv.d.kids) + week(tv.d.youtube) }))
    .filter((tv) => tv.total >= 1)
    .sort((a, b) => b.total - a.total);
  const avg = sum(starts.map((_, i) => days.kids[i] + days.youtube[i])) / DAYS;

  return (
    <Panel
      title={`${YOUTUBE.title} · screen time`}
      icon={TvMinimalPlay}
      accent={C.red}
      delay={delay}
      right={
        watching.length > 0 ? (
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: YT[watching[0].k] }}>
            <Dot color={YT[watching[0].k]} pulse /> Watching on {watching.map((w) => w.name).join(", ")}
          </span>
        ) : (
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-dx-faint">Not watching</span>
        )
      }
    >
      {!history ? (
        <div className="h-40 animate-pulse rounded bg-white/[0.03]" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_minmax(0,0.8fr)]">
          <div className="flex flex-col gap-3">
            <div>
              <Label>Today</Label>
              <Big value={hm(days.kids[DAYS - 1] + days.youtube[DAYS - 1])} size={28} />
            </div>
            <div>
              <Label>This week</Label>
              <Big value={hm(week(days.kids) + week(days.youtube))} size={22} />
            </div>
            <div>
              <Label>7-day avg / day</Label>
              <Big value={hm(avg)} size={18} />
            </div>
            <div className="flex gap-4 text-[11px] text-dx-dim">
              <span className="flex items-center gap-1.5">
                <Dot color={YT.kids} /> Kids
              </span>
              <span className="flex items-center gap-1.5">
                <Dot color={YT.youtube} /> YouTube
              </span>
            </div>
          </div>
          <StackedBars
            height={150}
            colors={[YT.youtube, YT.kids]}
            names={["YouTube", "Kids"]}
            format={(m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)}m`)}
            bars={starts.map((s, i) => ({
              label: new Date(s).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase().slice(0, 3),
              parts: [days.youtube[i], days.kids[i]],
            }))}
          />
          <div className="flex flex-col gap-2.5">
            <Label>This week by TV</Label>
            {tvs.length === 0 && <div className="text-[12px] text-dx-dim">Nothing yet this week.</div>}
            {tvs.map((tv) => (
              <HBar key={tv.id} label={tv.name} value={tv.total} max={tvs[0].total} display={hm(tv.total)} color={C.red} />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------- Notifications */

const PERSON_KEY = "ha-dashboard:push-person";

export function NotifyPanel({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const support = pushSupport();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const people = HOUSEHOLD_PEOPLE.map((id) => ({ key: id.split(".")[1], name: ((entities[id]?.attributes.friendly_name as string | undefined) ?? id.split(".")[1]).split(" ")[0] }));
  const [person, setPerson] = useState(() => {
    try {
      return localStorage.getItem(PERSON_KEY) ?? people[0]?.key ?? "";
    } catch {
      return people[0]?.key ?? "";
    }
  });

  useEffect(() => {
    if (support !== "supported") return;
    currentSubscription()
      .then((s) => setSubscribed(!!s && Notification.permission === "granted"))
      .catch(() => setSubscribed(false));
  }, [support]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (done) setMessage(done);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const status =
    support === "dev" ? "Dev build" : support !== "supported" ? "Unsupported" : subscribed === null ? "Checking" : subscribed ? "Subscribed" : "Off";
  const statusColor = subscribed ? C.green : C.faint;

  return (
    <Panel
      title="Alerts on this computer"
      icon={subscribed ? Bell : BellOff}
      accent={C.violet}
      delay={delay}
      right={
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: statusColor }}>
          <Dot color={statusColor} /> {status}
        </span>
      }
    >
      <p className="text-[12px] leading-relaxed text-dx-dim">
        Door, visitor and reminder alerts from Home Assistant, as browser notifications on this machine. Who it belongs to decides which personal alerts it gets.
      </p>
      {support === "supported" && subscribed === false && (
        <div className="mt-3 flex items-center gap-3">
          <div className="w-[200px]">
            <Segmented value={person} onChange={setPerson} options={people.map((p) => ({ value: p.key, label: p.name }))} />
          </div>
          <Btn
            color={C.violet}
            disabled={busy}
            onClick={() => {
              try {
                localStorage.setItem(PERSON_KEY, person);
              } catch {
                /* not remembered */
              }
              const name = people.find((p) => p.key === person)?.name ?? person;
              run(async () => {
                await enablePush(person, `${name}'s desktop`);
                setSubscribed(true);
                await sendTestPush();
              }, "Subscribed — a test alert is on its way.");
            }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />} Enable
          </Btn>
        </div>
      )}
      {support === "supported" && subscribed && (
        <div className="mt-3 flex gap-1.5">
          <Btn disabled={busy} onClick={() => run(sendTestPush, "Test sent.")}>
            Send test
          </Btn>
          <Btn
            disabled={busy}
            onClick={() =>
              run(async () => {
                await disablePush();
                setSubscribed(false);
              }, "Turned off for this computer.")
            }
          >
            Disable
          </Btn>
        </div>
      )}
      {message && <div className={clsx("dx-num mt-2 text-[11px]", message.includes("wrong") ? "text-dx-red" : "text-dx-dim")}>{message}</div>}
    </Panel>
  );
}

/* --------------------------------------------------- Fleet summary KPIs */

export function DevicesSummary() {
  const { entities, entitiesWithArea } = useHa();
  const up = CURATED_COMPUTERS.filter((c) => computerOnline(c, entities)).length;
  const clients = Object.values(entitiesWithArea).filter((e) => e.domain === "device_tracker" && e.platform === "unifi" && e.entity.state === "home").length;
  const S = DESKTOP_SERVER;
  const pool = num(entities[`sensor.skylab_${S.mounts.at(-1)!.key}_disk_usage`]);
  const temp = num(entities[S.temps[0].entityId]);
  const tUnit = unitOf(entities[S.temps[0].entityId]);
  const items: { label: string; icon: typeof Cpu; value: React.ReactNode; unit?: string; color: string }[] = [
    { label: "Hosts up", icon: Cpu, value: `${up}/${CURATED_COMPUTERS.length}`, color: C.green },
    { label: "Containers", icon: Boxes, value: entities[S.containers]?.state ?? "—", color: C.cyan },
    { label: "Server CPU", icon: Server, value: num(entities[S.cpu])?.toFixed(0) ?? "—", unit: "%", color: C.violet },
    { label: "Package temp", icon: Server, value: temp === null ? "—" : Math.round(temp), unit: tUnit, color: temp !== null ? tempScale(temp, tUnit).color : C.faint },
    { label: "Media pool", icon: HardDrive, value: pool === null ? "—" : Math.round(pool), unit: "% used", color: usageColor(pool) },
    { label: "Net clients", icon: Wifi, value: clients, unit: "online", color: C.pink },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      {items.map((it, i) => (
        <div key={it.label} className="dx-panel dx-in relative overflow-hidden px-4 py-3" style={{ animationDelay: `${i * 30}ms` }}>
          <span className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${it.color}, transparent)` }} />
          <div className="flex items-center justify-between">
            <Label>{it.label}</Label>
            <it.icon size={13} style={{ color: it.color }} />
          </div>
          <Big value={it.value} unit={it.unit} size={26} />
        </div>
      ))}
    </div>
  );
}
