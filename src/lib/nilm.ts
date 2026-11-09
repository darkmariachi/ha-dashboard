import { token } from "./push";

// Client for the unnamed-device detection service (nilm/app.py), proxied by
// nginx at /api/nilm/. Every call carries the signed-in HA token. Times from
// the service are Unix seconds.

export type LegSig = "240" | "L1" | "L2" | "?";

export interface NilmDevice {
  id: number;
  /** Stable letter (A, B, ... AA); HA entity ids are built from it. */
  label: string;
  name: string | null;
  color: string;
  sig: LegSig;
  watts: number;
  watts_range: [number, number];
  runs_7d: number;
  runs_per_day: number;
  /** Median run length, minutes (null until it has turned off once). */
  minutes: number | null;
  minutes_range: [number, number] | null;
  kwh_24h: number;
  kwh_7d: number;
  kwh_per_day: number;
  /** Runs started in each local hour, 0–23, over the last 7 days. */
  hours: number[];
  last_on: number | null;
  /** Watts it's drawing right now (0 = off). */
  on_w: number;
  hidden: boolean;
  /** Seen fewer than a handful of times; not published to HA yet. */
  candidate: boolean;
}

export interface NilmEvent {
  id: number;
  cluster: number;
  label: string;
  t_on: number;
  t_off: number | null;
  dp: number;
  sig: LegSig;
}

export interface NilmSample {
  t: number;
  other: number;
  total?: number | null;
  solar?: number | null;
}

export interface NilmStatus {
  source: "sense" | "ha" | "replay" | "none" | "error" | "backfill";
  detail: string;
  sample_interval_s: number | null;
  last_sample_age_s: number | null;
  samples: number;
  level_w: number | null;
  open_events: number;
  min_step_w: number;
  publishing: boolean;
}

export type NilmMessage =
  | { type: "hello"; source: string; detail: string }
  | { type: "ping" }
  | ({ type: "sample"; on: Record<string, number> } & NilmSample)
  | { type: "on"; event: number; cluster: number; label: string; t: number; dp: number }
  | { type: "off"; event: number; cluster: number; label: string; t: number; dur: number; dp: number };

/** The Authorization header. In `npm run dev` with nobody signed in, none:
 * a local service started with NILM_NO_AUTH=1 accepts that. */
function auth(): Record<string, string> {
  if (import.meta.env.DEV) {
    try {
      return { Authorization: `Bearer ${token()}` };
    } catch {
      return {};
    }
  }
  return { Authorization: `Bearer ${token()}` };
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/nilm/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...auth(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const nilmStatus = () => call<NilmStatus>("status");
export const nilmDevices = () => call<NilmDevice[]>("clusters");
export const nilmEvents = (limit = 60) => call<NilmEvent[]>(`events?limit=${limit}`);
export const nilmLive = (seconds: number) =>
  call<{ samples: NilmSample[]; events: NilmEvent[]; on: Record<string, number> }>(`live?seconds=${seconds}`);
export const renameDevice = (id: number, name: string) => call(`clusters/${id}`, { name });
export const hideDevice = (id: number, hidden: boolean) => call(`clusters/${id}`, { hidden });
export const mergeDevices = (ids: number[]) => call("merge", { ids });
export const backfillNilm = (days: number) => call<{ samples: number; clusters: number }>(`backfill?days=${days}`, {});

/**
 * Follow the live stream (newline-delimited JSON over fetch, so it can
 * carry the token). Reconnects until the returned stop() is called.
 */
export function followNilm(onMessage: (m: NilmMessage) => void, onState?: (connected: boolean) => void): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  const run = async () => {
    while (!stopped) {
      ctrl = new AbortController();
      try {
        const res = await fetch("/api/nilm/stream", { headers: auth(), signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        onState?.(true);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) onMessage(JSON.parse(line) as NilmMessage);
          }
        }
      } catch {
        /* fall through to retry */
      }
      onState?.(false);
      if (!stopped) await new Promise((r) => setTimeout(r, 5000));
    }
  };
  run();
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}

export const legLabel = (s: LegSig) => (s === "240" ? "240 V" : s === "?" ? "legs ?" : `120 V · ${s}`);
export const deviceName = (d: Pick<NilmDevice, "name" | "label">) => d.name || `Device ${d.label}`;
