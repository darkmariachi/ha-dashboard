import { ScanFace } from "lucide-react";
import { camLabel, frameError } from "../../lib/faces";
import { useFaceStats } from "../insights/FaceScanCard";
import { BarChart } from "./charts";
import { dur } from "./data";
import { Big, C, Dot, HBar, KV, Label, Panel, Ring } from "./ui";

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The face service's queue for the desktop Insights page. */
export function FaceScanPanel({ delay = 0 }: { delay?: number }) {
  const { stats: s, error } = useFaceStats();

  if (!s) {
    return (
      <Panel title="Face scanning" icon={ScanFace} accent={C.violet} delay={delay}>
        <div className="text-[12px] text-dx-dim">{error ? `Couldn't reach the face service: ${error}` : "Loading…"}</div>
      </Panel>
    );
  }

  const b = s.backfill;
  const total = b.done + b.pending + b.failed;
  const pct = total ? (b.done / total) * 100 : 100;
  const busy = s.queue.pending > 0;
  const f = s.faces;
  const named = f.confirmed ?? 0;
  const matched = f.auto ?? 0;
  const unnamed = f.unknown ?? 0;
  const ignored = f.ignored ?? 0;
  const hours = [...s.hourly].reverse();
  const now = s.now;
  const at = s.current ?? s.next;

  return (
    <Panel
      title="Face scanning"
      icon={ScanFace}
      accent={C.violet}
      delay={delay}
      right={
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: busy ? C.violet : C.green }}>
          <Dot color={busy ? C.violet : C.green} pulse={busy} /> {!s.model.startsWith("ready") ? `model ${s.model}` : busy ? "scanning" : "caught up"}
        </span>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex gap-4">
          <Ring value={pct} label="Backfill" sub={`${b.done.toLocaleString()} / ${total.toLocaleString()}`} color={C.violet} size={96} />
          <Ring
            value={s.cpu.cores != null && s.cpu.limit ? (s.cpu.cores / s.cpu.limit) * 100 : null}
            text={s.cpu.cores != null ? s.cpu.cores.toFixed(1) : undefined}
            unit="cores"
            label="CPU"
            sub={s.cpu.limit ? `cap ${s.cpu.limit} of ${s.cpu.host_cores}` : undefined}
            color={C.amber}
            size={96}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Pace</Label>
              <Big value={s.rate_per_hour.toLocaleString()} unit="/h" size={24} />
            </div>
            <div>
              <Label>Time left</Label>
              <Big value={b.pending === 0 ? "done" : s.eta_ms ? dur(s.eta_ms) : "—"} size={24} />
            </div>
            <div>
              <Label>Live delay</Label>
              <Big value={s.live.avg_delay_ms != null ? Math.max(1, Math.round(s.live.avg_delay_ms / 1000)) : "—"} unit="s" size={24} />
            </div>
          </div>
          <div>
            <Label className="mb-1">Frames scanned per hour · 24h</Label>
            <BarChart
              height={84}
              from={C.violet}
              to={C.pink}
              highlight={23}
              format={(v) => `${v} frames`}
              bars={hours.map(([frames, faces], i) => ({ label: i % 6 === 0 ? `-${24 - i}h` : "", value: frames, sub: `${faces} faces` }))}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <Label>Faces · {(f.n ?? 0).toLocaleString()}</Label>
          <HBar label="Named" value={named} max={f.n || 1} display={named.toLocaleString()} color={C.green} />
          <HBar label="Matched automatically" value={matched} max={f.n || 1} display={matched.toLocaleString()} color={C.violet} />
          <HBar label="Unnamed" value={unnamed} max={f.n || 1} display={unnamed.toLocaleString()} color={C.dim} />
          <HBar label="Ignored" value={ignored} max={f.n || 1} display={ignored.toLocaleString()} color={C.faint} />
          <div className="mt-1">
            {at && <KV k={s.current ? "Now scanning" : "Up next"} v={`${camLabel(at.camera)} · ${when(at.t)}${at.prio > 0 ? " · live" : ""}`} />}
            {b.oldest_pending && <KV k="Working back to" v={new Date(b.oldest_pending).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />}
            <KV k="Live detections · 24h" v={s.live.done_24h} />
            {s.live.last_detection && <KV k="Last live detection" v={`${dur(now - s.live.last_detection)} ago`} />}
            <KV k="Faces per frame" v={`${Math.round(((f.n ?? 0) / Math.max(1, s.queue.done)) * 100)}%`} />
            <KV
              k="Failed frames"
              v={s.queue.failed}
              color={s.queue.failed ? C.amber : undefined}
              dot={s.queue.failed ? C.amber : C.green}
            />
          </div>
          {s.errors[0] && <div className="dx-num truncate text-[10.5px] text-dx-amber" title={s.errors[0].error}>last error: {frameError(s.errors[0].error)}</div>}
        </div>
      </div>

      {s.faces_per_day.length > 0 && (
        <div className="mt-4 border-t border-dx-line pt-3">
          <Label className="mb-1">Faces by day they were seen · 30 days</Label>
          <BarChart
            height={64}
            from={C.cyan}
            to={C.violet}
            format={(v) => `${v} faces`}
            bars={s.faces_per_day.map((d, i, all) => ({
              label: i === 0 || i === all.length - 1 || i % 7 === 0 ? d.d.slice(5).replace("-", "/") : "",
              value: d.n,
            }))}
          />
        </div>
      )}
    </Panel>
  );
}
