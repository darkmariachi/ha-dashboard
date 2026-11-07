import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ScanFace } from "lucide-react";
import { camLabel, faceStats, frameError, type FaceStats } from "../../lib/faces";

const ACCENT = "#7c5fc4";
const GREEN = "#2fae7e";
const AMBER = "#d9822b";

/** 5_400_000 -> "1 h 30 min". */
function span(ms: number) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Polls the face service's /stats every few seconds. */
export function useFaceStats(everyMs = 10_000) {
  const [stats, setStats] = useState<FaceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      faceStats()
        .then((s) => {
          if (cancelled) return;
          setStats(s);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    load();
    const t = setInterval(load, everyMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [everyMs]);
  return { stats, error };
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl px-3.5 py-3" style={{ background: "var(--chip-off)" }}>
      <div className="text-xs text-text-dim">{label}</div>
      <div className="text-[22px] font-light leading-tight tracking-[-0.5px] tabular-nums text-text">{value}</div>
      {sub && <div className="text-xs text-text-dim">{sub}</div>}
    </div>
  );
}

/**
 * The face service's work queue on the Insights tab: backfill progress and
 * ETA, throughput over the last day, live-detection delay, what it's on
 * right now, faces found and named, CPU use against its cap, and errors.
 */
export function FaceScanCard({ index = 0 }: { index?: number }) {
  const { stats: s, error } = useFaceStats();

  if (!s) {
    return (
      <div className="glass rise flex items-center gap-2 rounded-[26px] p-5 text-sm text-text-dim" style={{ animationDelay: `${100 + index * 70}ms` }}>
        {error ? `Face scanning: ${error}` : <><Loader2 size={16} className="animate-spin" /> Loading face scanning…</>}
      </div>
    );
  }

  const b = s.backfill;
  const total = b.done + b.pending + b.failed;
  const pct = total ? (b.done / total) * 100 : 100;
  const busy = s.queue.pending > 0;
  const hours = [...s.hourly].reverse(); // oldest first
  const maxFrames = Math.max(1, ...hours.map((h) => h[0]));
  const f = s.faces;
  const parts = [
    { label: "Named", n: f.confirmed ?? 0, color: GREEN },
    { label: "Matched", n: f.auto ?? 0, color: ACCENT },
    { label: "Unnamed", n: f.unknown ?? 0, color: "#9aa1b5" },
    { label: "Ignored", n: f.ignored ?? 0, color: "#5f6577" },
  ];
  const facesTotal = parts.reduce((a, p) => a + p.n, 0) || 1;
  const framesDone = s.queue.done || 1;
  const cpu = s.cpu.cores;

  return (
    <div className="glass rise flex flex-col gap-4 rounded-[26px] p-5" style={{ animationDelay: `${100 + index * 70}ms` }}>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: "var(--chip-off)", color: ACCENT }}>
          <ScanFace size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[19px] font-semibold tracking-[-0.3px] text-text">Face scanning</div>
          <div className="truncate text-[13px] text-text-dim">
            {!s.model.startsWith("ready")
              ? `Model ${s.model}`
              : busy
                ? `Scanning past detections · ${s.queue.pending.toLocaleString()} frames to go`
                : "Caught up · watching live detections"}
          </div>
        </div>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: ACCENT }}>
            <span className="live-dot h-2 w-2 rounded-full" style={{ background: ACCENT }} /> Live
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="font-semibold text-text">Backfill</span>
          <span className="tabular-nums text-text-dim">
            {b.done.toLocaleString()} / {total.toLocaleString()} frames · {Math.floor(pct)}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-text-dim/20">
          <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: ACCENT }} />
        </div>
        <div className="text-xs text-text-dim">
          {b.pending === 0
            ? "All past detections scanned."
            : `${s.eta_ms ? `About ${span(s.eta_ms)} left at the current pace` : "Estimating time left…"}${b.oldest_pending ? ` · working back to ${new Date(b.oldest_pending).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tile label="Pace" value={`${s.rate_per_hour.toLocaleString()}/h`} sub="frames, last hour" />
        <Tile label="Faces found" value={(f.n ?? 0).toLocaleString()} sub={`in ${Math.round(((f.n ?? 0) / framesDone) * 100)}% of frames`} />
        <Tile
          label="Live detections"
          value={s.live.done_24h}
          sub={s.live.avg_delay_ms != null ? `last 24 h · ready in ~${Math.max(1, Math.round(s.live.avg_delay_ms / 1000))} s` : "last 24 h"}
        />
        <Tile
          label="CPU"
          value={cpu != null ? `${cpu.toFixed(1)} cores` : "—"}
          sub={s.cpu.limit ? `capped at ${s.cpu.limit} of ${s.cpu.host_cores}` : s.cpu.host_cores ? `of ${s.cpu.host_cores}` : undefined}
        />
      </div>

      {(s.current || s.next) && (
        <div className="rounded-2xl px-3.5 py-2.5 text-[13px]" style={{ background: "var(--chip-off)" }}>
          <span className="text-text-dim">{s.current ? "Now scanning " : "Up next "}</span>
          <span className="font-semibold text-text">
            {camLabel((s.current ?? s.next)!.camera)} · {when((s.current ?? s.next)!.t)}
          </span>
          {(s.current ?? s.next)!.prio > 0 && <span style={{ color: GREEN }}> · live</span>}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Last 24 hours</span>
          <span className="text-xs text-text-dim">frames scanned per hour</span>
        </div>
        <div className="flex h-16 items-end gap-[3px]">
          {hours.map(([frames, faces], i) => (
            <div
              key={i}
              title={`${23 - i === 0 ? "This hour" : `${23 - i} h ago`}: ${frames} frames, ${faces} faces`}
              className="flex-1 rounded-t-[3px]"
              style={{ height: `${Math.max(frames ? 6 : 2, (frames / maxFrames) * 100)}%`, background: frames ? ACCENT : "var(--chip-off)", opacity: i === 23 ? 1 : 0.7 }}
            />
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-text-dim">
          <span>24 h ago</span>
          <span>now</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">Faces</span>
        <div className="flex h-2.5 overflow-hidden rounded-full">
          {parts.map((p) => (
            <div key={p.label} style={{ width: `${(p.n / facesTotal) * 100}%`, background: p.color }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-dim">
          {parts.map((p) => (
            <span key={p.label} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} /> {p.label} {p.n.toLocaleString()}
            </span>
          ))}
        </div>
      </div>

      {s.queue.failed > 0 && (
        <div className="flex items-start gap-2 text-xs" style={{ color: AMBER }}>
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>
            {s.queue.failed} {s.queue.failed === 1 ? "frame" : "frames"} couldn't be fetched after 3 tries
            {s.errors[0] && ` · last: ${frameError(s.errors[0].error)}`}
          </span>
        </div>
      )}
    </div>
  );
}
