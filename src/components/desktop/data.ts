import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import type { CuratedComputer } from "../../config/computers";
import { CURATED_DOOR_SENSORS, CURATED_ENERGY } from "../../config/curatedHome";
import {
  DESKTOP_ALARM,
  DESKTOP_APPLIANCES,
  DESKTOP_NETWORK,
  DESKTOP_SAFETY,
  DESKTOP_SERVER,
  DESKTOP_WINDOWS,
  LOW_BATTERY_PCT,
} from "../../config/desktop";
import { useHa } from "../../ha/HaProvider";
import type { StatePoint } from "../home/useStateHistory";

/** The Sense monitor's own sensors share this prefix. */
export const SENSE = CURATED_ENERGY.consumption.replace(/_energy$/, "");
const NOT_DEVICES = new Set(["solar", "sense_energy_monitor"]);

export function num(e: HassEntity | undefined): number | null {
  if (!e) return null;
  const v = parseFloat(e.state);
  return Number.isFinite(v) ? v : null;
}

export function isLive(e: HassEntity | undefined) {
  return !!e && e.state !== "unavailable" && e.state !== "unknown";
}

/** 1234 -> "1.23 kW", 640 -> "640 W". */
export function fmtW(w: number | null) {
  if (w === null) return "—";
  return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
}

export const fmtMbps = (v: number | null) => (v === null ? "—" : v >= 100 ? v.toFixed(0) : v.toFixed(1));

/** A data-rate reading in Mbit/s, whatever unit the sensor reports. */
export function toMbps(v: number | null, unit: string | undefined) {
  if (v === null) return null;
  switch (unit) {
    case "Mbit/s":
      return v;
    case "kbit/s":
      return v / 1000;
    case "Gbit/s":
      return v * 1000;
    case "bit/s":
      return v / 1e6;
    case "MB/s":
      return v * 8;
    case "kB/s":
      return (v * 8) / 1000;
    case "B/s":
      return (v * 8) / 1e6;
    case "GB/s":
      return v * 8000;
    default:
      // The UDM's UPnP sensors: KiB/s.
      return (v * 1024 * 8) / 1e6;
  }
}

export interface ThroughputSource {
  kind: "upnp" | "wan-port" | "lan";
  label: string;
  down: string;
  up: string;
}

/** Where internet throughput comes from: UPnP, else the UDM's WAN port
 * sensors, else (not internet at all) skylab's LAN port. */
export function throughputSource(entities: HassEntities): ThroughputSource {
  if (isLive(entities[DESKTOP_NETWORK.down])) return { kind: "upnp", label: "Internet", down: DESKTOP_NETWORK.down, up: DESKTOP_NETWORK.up };
  if (isLive(entities[DESKTOP_NETWORK.wanPort.down]))
    return { kind: "wan-port", label: "Internet", down: DESKTOP_NETWORK.wanPort.down, up: DESKTOP_NETWORK.wanPort.up };
  return { kind: "lan", label: "LAN · skylab", down: DESKTOP_SERVER.nic.rx, up: DESKTOP_SERVER.nic.tx };
}

/** A throughput sensor's reading in Mbit/s. */
export function rateOf(entities: HassEntities, id: string) {
  return toMbps(num(entities[id]), entities[id]?.attributes.unit_of_measurement as string | undefined);
}

/** "3d 4h", "2h 10m", "5m". */
export function dur(ms: number) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mins % 60}m`;
  return `${mins}m`;
}

export function clock(t: number) {
  return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Spans [start, end) during which a history was in one of `states`. */
export function spans(points: StatePoint[] | undefined, isOn: (s: string) => boolean, from: number, now: number) {
  const out: { start: number; end: number }[] = [];
  (points ?? []).forEach((p, i, all) => {
    if (!isOn(p.state)) return;
    const start = Math.max(p.t, from);
    const end = i + 1 < all.length ? all[i + 1].t : now;
    if (end > start) out.push({ start, end });
  });
  return out;
}

/** Appliances Sense has learned: every sensor.<x>_power with a
 * sensor.<x>_daily_energy. */
export function senseDevices(entities: HassEntities) {
  const out: { name: string; power: number; today: number | null }[] = [];
  for (const id of Object.keys(entities)) {
    const m = id.match(/^sensor\.(.+)_power$/);
    if (!m || NOT_DEVICES.has(m[1]) || !entities[`sensor.${m[1]}_daily_energy`]) continue;
    const power = num(entities[id]);
    if (power === null) continue;
    const name = ((entities[id].attributes.friendly_name as string | undefined) ?? m[1]).replace(/\s*Power$/i, "");
    out.push({ name, power, today: num(entities[`sensor.${m[1]}_daily_energy`]) });
  }
  return out.sort((a, b) => b.power - a.power);
}

/** Doors and windows; which are open now. */
export function useOpenings() {
  const { entities } = useHa();
  const all = [
    ...CURATED_DOOR_SENSORS.map((d) => ({ ...d, kind: "door" as const })),
    ...DESKTOP_WINDOWS.map((w) => ({ ...w, kind: "window" as const })),
  ].filter((d) => entities[d.entityId]);
  const open = all.filter((d) => entities[d.entityId]?.state === "on");
  return { all, open };
}

/** Is a computer up right now (same rule as ComputerCard)? */
export function computerOnline(c: CuratedComputer, entities: HassEntities) {
  if (c.activity) return entities[c.activity.entityId]?.state === "on";
  return isLive(entities[c.onlineEntity]) && (!c.pingEntity || entities[c.pingEntity]?.state !== "off");
}

export function lowBatteries(entities: HassEntities) {
  return Object.values(entities)
    .filter((e) => e.entity_id.startsWith("sensor.") && e.attributes.device_class === "battery" && e.attributes.unit_of_measurement === "%")
    .map((e) => ({ e, v: num(e) }))
    .filter((x): x is { e: HassEntity; v: number } => x.v !== null && x.v <= LOW_BATTERY_PCT)
    .sort((a, b) => a.v - b.v);
}

export interface Issue {
  label: string;
  detail: string;
  severity: "warn" | "danger";
}

/** Everything around the house that needs attention. */
export function useIssues() {
  const { entities } = useHa();
  const issues: Issue[] = [];
  for (const s of DESKTOP_SAFETY) {
    if (entities[s.entityId]?.state === "on") issues.push({ label: s.label, detail: "detected", severity: "danger" });
  }
  if (entities[DESKTOP_ALARM]?.state === "triggered") issues.push({ label: "Alarm", detail: "triggered", severity: "danger" });
  if (entities[DESKTOP_NETWORK.wan]?.state === "off") issues.push({ label: "Internet", detail: "down", severity: "danger" });
  for (const a of DESKTOP_APPLIANCES) {
    if (a.kind === "problem" && entities[a.entityId]?.state === "on") issues.push({ label: a.label, detail: "replace", severity: "warn" });
  }
  const updates = Object.values(entities).filter((e) => e.entity_id.startsWith("update.") && e.state === "on");
  if (updates.length) issues.push({ label: "Updates", detail: `${updates.length} available`, severity: "warn" });
  const low = lowBatteries(entities);
  if (low.length) issues.push({ label: "Batteries", detail: `${low.length} low`, severity: "warn" });
  return { issues, updates, low };
}
