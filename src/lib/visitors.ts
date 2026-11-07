import { post, token } from "./push";

// Client for the push service's visit log (push/visits.mjs): who's been on
// the Wi-Fi and when. The service records every roaming device; naming one
// here turns its sessions into a visitor's visits.

export interface Visitor {
  id: string;
  name: string;
  devices: string[];
  notify: boolean;
}

export interface Session {
  start: number;
  end: number | null;
  /** Where the visit came from, once camera sightings are merged in
   * (allVisits); plain Wi-Fi sessions leave it unset. */
  source?: "wifi" | "camera" | "both";
}

/** A device's network identity, as the push service last saw it. UniFi
 * only reports the IP while the device is connected, so `ip` is the last
 * one it had (at `ipAt`), and `ips` the last few distinct ones. */
export interface DeviceInfo {
  mac?: string;
  oui?: string;
  host?: string;
  ip?: string;
  ips?: string[];
  ipAt?: number;
  essid?: string;
  radio?: string;
  ap?: string;
}

export interface VisitLog {
  people: Visitor[];
  hidden: string[];
  names: Record<string, string>;
  sessions: Record<string, Session[]>;
  /** Missing on push services older than this field. */
  info?: Record<string, DeviceInfo>;
}

export function fetchVisitLog(): Promise<VisitLog> {
  return post("visitors/list", { token: token() });
}

export function saveVisitor(person: Partial<Visitor> & { name: string; devices: string[] }): Promise<Visitor> {
  return post("visitors/person", { token: token(), person });
}

export function deleteVisitor(id: string) {
  return post("visitors/delete", { token: token(), id });
}

export function hideDevice(entityId: string, hidden: boolean) {
  return post("visitors/hide", { token: token(), entityId, hidden });
}

/** One person's visits across all their devices, overlapping sessions
 * joined (two phones arriving together is one visit). Newest first. */
export function visitsOf(devices: string[], sessions: Record<string, Session[]>): Session[] {
  const all = devices.flatMap((d) => sessions[d] ?? []).sort((a, b) => a.start - b.start);
  const merged: Session[] = [];
  for (const s of all) {
    const last = merged[merged.length - 1];
    if (last && (last.end === null || s.start <= last.end)) {
      last.end = last.end === null || s.end === null ? null : Math.max(last.end, s.end);
    } else {
      merged.push({ ...s });
    }
  }
  return merged.reverse();
}

export function duration(ms: number) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

export function clock(t: number) {
  return new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "today", "yesterday", "Mon", or "Oct 12" for older. */
export function dayLabel(t: number, now: Date) {
  const d = new Date(t);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------- camera-based visits */

/** Sightings this close together are one visit. */
const SIGHTING_GAP = 30 * 60_000;
/** A lone sighting still reads as a short visit. */
const MIN_CAMERA_VISIT = 2 * 60_000;
/** A Wi-Fi visit and a camera one this close are the same visit. */
const MERGE_SLACK = 20 * 60_000;
/** A device on the Wi-Fi this long without a break lives here. */
const RESIDENT_MS = 2 * 86_400_000;

/** Face sightings (ms) grouped into visits, newest first. */
export function cameraVisits(times: number[] | undefined): Session[] {
  const out: Session[] = [];
  for (const t of [...(times ?? [])].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && t - (last.end ?? t) <= SIGHTING_GAP) last.end = Math.max(last.end ?? t, t);
    else out.push({ start: t, end: t, source: "camera" });
  }
  for (const v of out) v.end = Math.max(v.end ?? v.start, v.start + MIN_CAMERA_VISIT);
  return out.reverse();
}

/** Wi-Fi and camera visits as one list, newest first; overlapping ones
 * (give or take 20 min: people reach the door before their phone joins)
 * are merged and marked "both". */
export function mergeVisits(wifi: Session[], camera: Session[]): Session[] {
  const all = [...wifi.map((v) => ({ ...v, source: v.source ?? ("wifi" as const) })), ...camera.map((v) => ({ ...v }))].sort(
    (a, b) => a.start - b.start,
  );
  const out: Session[] = [];
  for (const v of all) {
    const last = out[out.length - 1];
    const lastEnd = last ? (last.end ?? Infinity) : -Infinity;
    if (last && v.start <= lastEnd + MERGE_SLACK && v.start >= last.start - MERGE_SLACK) {
      last.start = Math.min(last.start, v.start);
      last.end = last.end === null || v.end === null ? null : Math.max(last.end, v.end);
      if (last.source !== v.source) last.source = "both";
    } else {
      out.push(v);
    }
  }
  return out.reverse();
}

/** A visitor's visits from their phones and from the cameras. `seen` is
 * the face service's sightings by subject (useFaceSeen). */
export function allVisits(person: Visitor, log: VisitLog, seen: Record<string, number[]>): Session[] {
  return mergeVisits(visitsOf(person.devices, log.sessions), cameraVisits(seen[person.id]));
}

export interface DeviceSuggestion {
  id: string;
  name: string;
  /** Camera visits of this person the device was on the Wi-Fi for. */
  hits: number;
  /** How many camera visits the person has. */
  of: number;
  /** The device's own visit count (lots of other visits = weaker hint). */
  visits: number;
}

/**
 * Unlinked devices that were on the Wi-Fi while this person was seen at the
 * door: the reverse of the faces-from-Wi-Fi suggestions. Skips devices that
 * belong to someone (visitor or household), dismissed ones, and anything
 * that was on for days at a stretch (it lives here).
 */
export function deviceSuggestions(
  person: Visitor,
  log: VisitLog,
  seen: Record<string, number[]>,
  household: Set<string>,
  now: number,
): DeviceSuggestion[] {
  const cams = cameraVisits(seen[person.id]);
  if (cams.length === 0) return [];
  const owned = new Set(log.people.flatMap((p) => p.devices));
  const out: DeviceSuggestion[] = [];
  for (const [id, sessions] of Object.entries(log.sessions)) {
    if (owned.has(id) || household.has(id) || log.hidden.includes(id)) continue;
    const hits = cams.filter((c) =>
      sessions.some((s) => {
        const end = s.end ?? now;
        if (end - s.start > RESIDENT_MS) return false;
        return s.start - MERGE_SLACK <= (c.end ?? now) && end + 5 * 60_000 >= c.start;
      }),
    ).length;
    if (hits > 0) out.push({ id, name: log.names[id] ?? id, hits, of: cams.length, visits: visitsOf([id], log.sessions).length });
  }
  return out.sort((a, b) => b.hits - a.hits || a.visits - b.visits).slice(0, 6);
}
