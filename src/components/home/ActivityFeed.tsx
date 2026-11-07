import { Activity, BellRing, Car, ImageOff, Package, PawPrint, User, type LucideIcon } from "lucide-react";
import { createElement, useEffect, useState } from "react";
import clsx from "clsx";
import { FEED_HOURS, FEED_SOURCES, PROTECT_ENTRY_ID, type FeedSource } from "../../config/cameraFeed";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { Sheet } from "./Sheet";
import { useStateHistory } from "./useStateHistory";
import { useFaceNames } from "../../lib/useFaceNames";

export interface CameraEvent {
  id: string;
  source: FeedSource;
  type: string;
  /** Epoch ms of the detection. */
  t: number;
}

const TYPES: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  ring: { label: "Doorbell", icon: BellRing, color: "#d9822b" },
  person: { label: "Person", icon: User, color: "#4f79c9" },
  vehicle: { label: "Vehicle", icon: Car, color: "#7c5fc4" },
  animal: { label: "Animal", icon: PawPrint, color: "#2f9e6f" },
  package: { label: "Package", icon: Package, color: "#cc5d70" },
  motion: { label: "Motion", icon: Activity, color: "#8a8478" },
};

export function typeInfo(type: string) {
  return TYPES[type] ?? { label: type.charAt(0).toUpperCase() + type.slice(1), icon: Activity, color: "#8a8478" };
}

const FILTERS: { key: string; label: string; types: string[] | null }[] = [
  { key: "all", label: "All", types: null },
  { key: "people", label: "People", types: ["person", "ring"] },
  { key: "vehicles", label: "Vehicles", types: ["vehicle"] },
  { key: "packages", label: "Packages", types: ["package"] },
  { key: "motion", label: "Other", types: ["animal", "motion"] },
];

/** Protect timestamps in the proxy URLs: ISO, whole seconds. */
function iso(t: number) {
  return new Date(Math.round(t / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

export function snapshotPath(e: CameraEvent, width: number) {
  return `/api/unifiprotect/snapshot/${PROTECT_ENTRY_ID}/${e.source.camera}/${iso(e.t + 1000)}?width=${width}`;
}

function clipPath(e: CameraEvent) {
  return `/api/unifiprotect/video/${PROTECT_ENTRY_ID}/${e.source.camera}/${iso(e.t - 3000)}/${iso(e.t + 15000)}`;
}

/** Recent detections from all feed sources, newest first; refreshed every
 * minute and topped up live from the entities' current states. */
export function useCameraEvents(now: Date) {
  const { entities } = useHa();
  const history = useStateHistory(
    FEED_SOURCES.map((s) => s.entityId),
    FEED_HOURS,
    { withAttributes: true, refreshMs: 60_000 },
  );
  if (!history) return null;

  const seen = new Set<string>();
  const out: CameraEvent[] = [];
  const since = now.getTime() - FEED_HOURS * 3600 * 1000;
  for (const source of FEED_SOURCES) {
    const points = [...(history[source.entityId] ?? [])];
    const live = entities[source.entityId];
    if (live) points.push({ state: live.state, t: 0, attributes: live.attributes });
    for (const p of points) {
      // An event entity's state is the event's own timestamp; restarts and
      // unavailability show up as repeats or non-dates, so dedupe on it.
      const t = Date.parse(p.state);
      if (!Number.isFinite(t) || t < since) continue;
      const id = `${source.entityId}|${p.state}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const type = source.type ?? (p.attributes?.event_type as string | undefined) ?? "motion";
      out.push({ id, source, type, t });
    }
  }
  return out.sort((a, b) => b.t - a.t);
}

/** <img> for an HA path that needs signing (the Protect proxy requires
 * auth); signs once per path. */
const signedCache = new Map<string, string>();
export function SignedImg({ path, className }: { path: string; className?: string }) {
  const { signPath } = useHa();
  const [src, setSrc] = useState(() => signedCache.get(path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (signedCache.has(path)) return;
    let cancelled = false;
    signPath(path, 300)
      .then((url) => {
        signedCache.set(path, url);
        if (!cancelled) setSrc(url);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [path, signPath]);

  if (failed) {
    return (
      <div className={clsx("flex items-center justify-center bg-black/40 text-white/60", className)}>
        <ImageOff size={18} />
      </div>
    );
  }
  return src ? (
    <img src={src} alt="" loading="lazy" className={clsx("bg-black/40 object-cover", className)} onError={() => setFailed(true)} />
  ) : (
    <div className={clsx("animate-pulse bg-black/30", className)} />
  );
}

function when(t: number, now: Date) {
  const mins = Math.round((now.getTime() - t) / 60000);
  const time = new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (mins < 1) return `${time} · just now`;
  if (mins < 60) return `${time} · ${mins} min ago`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return t >= startOfToday.getTime() ? time : `yesterday ${time}`;
}

/** Full-size snapshot plus the clip around the detection. */
function EventSheet({ event, onClose }: { event: CameraEvent; onClose: () => void }) {
  const { signPath } = useHa();
  const [clip, setClip] = useState<string | null>(null);
  const [clipFailed, setClipFailed] = useState(false);
  const info = typeInfo(event.type);

  useEffect(() => {
    let cancelled = false;
    signPath(clipPath(event), 300)
      .then((url) => !cancelled && setClip(url))
      .catch(() => !cancelled && setClipFailed(true));
    return () => {
      cancelled = true;
    };
  }, [event, signPath]);

  return (
    <Sheet
      title={`${info.label} · ${event.source.label}`}
      subtitle={new Date(event.t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", second: "2-digit" })}
      onClose={onClose}
    >
      {clip && !clipFailed ? (
        <video
          src={clip}
          poster={signedCache.get(snapshotPath(event, 640))}
          controls
          autoPlay
          muted
          playsInline
          onError={() => setClipFailed(true)}
          className="aspect-video w-full rounded-2xl bg-black"
        />
      ) : (
        <SignedImg path={snapshotPath(event, 640)} className="aspect-video w-full rounded-2xl" />
      )}
      <p className="text-xs text-text-dim">
        {clipFailed
          ? "The clip isn't available (it may not be recorded yet). Showing the snapshot."
          : "Clip from 3 s before to 15 s after the detection."}
      </p>
    </Sheet>
  );
}

/**
 * Camera activity: recent UniFi Protect detections with thumbnails.
 * `compact` is the tablet strip (a row of the latest few); the full list
 * (phone Cameras tab) has filters and groups by Today / Yesterday.
 */
export function ActivityFeed({ compact = false, limit = 40 }: { compact?: boolean; limit?: number }) {
  const now = useNow(60_000);
  const events = useCameraEvents(now);
  // Person / ring detections the face service recognised get the name.
  const faceName = useFaceNames(FEED_HOURS);
  const who = (e: CameraEvent) => (e.type === "person" || e.type === "ring" ? faceName(e.source.camera, e.t) : null);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<CameraEvent | null>(null);

  const types = FILTERS.find((f) => f.key === filter)?.types;
  const shown = (events ?? []).filter((e) => !types || types.includes(e.type)).slice(0, compact ? 6 : limit);

  const sheet = open && <EventSheet event={open} onClose={() => setOpen(null)} />;

  if (compact) {
    return (
      <>
        {!events ? (
          <div className="h-28 animate-pulse rounded-2xl bg-white/10" />
        ) : shown.length === 0 ? (
          <p className="hero-shadow text-sm text-white/75">Nothing detected in the last {FEED_HOURS} hours.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
            {shown.map((e) => {
              const info = typeInfo(e.type);
              return (
                <button key={e.id} onClick={() => setOpen(e)} className="group relative overflow-hidden rounded-2xl text-left shadow-[var(--glass-shadow)]">
                  <SignedImg path={snapshotPath(e, 320)} className="aspect-video w-full transition-transform group-active:scale-95" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-1.5 pt-5 text-white">
                    <div className="flex items-center gap-1 text-xs font-semibold">
                      {createElement(info.icon, { size: 12 })}
                      {who(e) ?? info.label} · {e.source.label}
                    </div>
                    <div className="text-[11px] opacity-80">{when(e.t, now)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {sheet}
      </>
    );
  }

  // Full list, grouped by day.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const groups: { day: string; items: CameraEvent[] }[] = [];
  for (const e of shown) {
    const day = e.t >= startOfToday.getTime() ? "Today" : "Yesterday";
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(e);
  }

  return (
    <div className="glass flex flex-col gap-3 rounded-[26px] p-4">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors"
            style={filter === f.key ? { background: "#4f79c9", color: "#fff" } : { background: "var(--chip-off)", color: "var(--color-text)" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!events ? (
        <div className="h-40 animate-pulse rounded-2xl bg-chip" />
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-dim">Nothing here in the last {FEED_HOURS} hours.</p>
      ) : (
        groups.map((g) => (
          <div key={g.day} className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">{g.day}</div>
            {g.items.map((e) => {
              const info = typeInfo(e.type);
              return (
                <button key={e.id} onClick={() => setOpen(e)} className="flex items-center gap-3 text-left active:opacity-70">
                  <SignedImg path={snapshotPath(e, 320)} className="aspect-video w-28 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
                      <span style={{ color: info.color }}>{createElement(info.icon, { size: 15 })}</span>
                      {who(e) ?? info.label}
                    </div>
                    <div className="truncate text-[13px] text-text-dim">
                      {who(e) ? `${info.label} · ${e.source.label}` : e.source.label}
                    </div>
                    <div className="text-xs text-text-dim">{when(e.t, now)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        ))
      )}
      {sheet}
    </div>
  );
}
