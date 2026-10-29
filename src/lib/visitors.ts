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
}

export interface VisitLog {
  people: Visitor[];
  hidden: string[];
  names: Record<string, string>;
  sessions: Record<string, Session[]>;
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
