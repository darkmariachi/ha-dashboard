import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { Bell, CalendarDays, Clock, EyeOff, History, Loader2, Smartphone, Trash2, UserPlus, Users, X } from "lucide-react";
import { HOUSEHOLD_PEOPLE } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { deleteVisitor, fetchVisitLog, hideDevice, saveVisitor, visitsOf, type Session, type VisitLog, type Visitor } from "../../lib/visitors";
import { Timeline } from "./charts";
import { dur } from "./data";
import { Big, Btn, C, Dot, Label, Panel, Switch } from "./ui";

const DAY = 86_400_000;
const WINDOW_DAYS = 30;
const NEW_DEVICE_DAYS = 30;
const RESIDENT_DAYS = 2;
const PALETTE = [C.cyan, C.pink, C.violet, C.green, C.amber];

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const hhmm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

function within(visits: Session[], from: number, now: number) {
  return visits.filter((v) => (v.end ?? now) >= from);
}

function totalMs(visits: Session[], from: number, now: number) {
  return visits.reduce((n, v) => n + Math.max(0, (v.end ?? now) - Math.max(v.start, from)), 0);
}

/** "3h ago" / "now" for the roster. */
function lastSeen(visits: Session[], here: boolean, now: number) {
  if (here) return "here now";
  const v = visits[0];
  if (!v) return "never";
  return `${dur(now - (v.end ?? now))} ago`;
}

const INPUT =
  "rounded-md border border-dx-line bg-dx-raise px-2.5 py-1.5 text-[12px] text-dx-text outline-none placeholder:text-dx-faint focus:border-dx-cyan/60";

/* ------------------------------------------------------------- heatmap */

/** 24 hours × last 30 days, each cell lit by minutes present. */
function PresenceHeatmap({ visits, now, color }: { visits: Session[]; now: number; color: string }) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const starts = Array.from({ length: WINDOW_DAYS }, (_, i) => today.getTime() - (WINDOW_DAYS - 1 - i) * DAY);
  const grid = starts.map(() => new Array<number>(24).fill(0));
  for (const v of visits) {
    const end = v.end ?? now;
    starts.forEach((s, d) => {
      for (let h = 0; h < 24; h++) {
        const a = s + h * 3600_000;
        const o = Math.min(end, a + 3600_000) - Math.max(v.start, a);
        if (o > 0) grid[d][h] += o / 60_000;
      }
    });
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-[3px]">
        <div className="flex w-7 flex-col justify-between py-[1px] text-[9px] text-dx-faint">
          {["00", "06", "12", "18", "23"].map((h) => (
            <span key={h} className="dx-num leading-none">
              {h}
            </span>
          ))}
        </div>
        {grid.map((hours, d) => (
          <div key={d} className="flex flex-1 flex-col gap-[3px]" title={day(starts[d])}>
            {hours.map((m, h) => (
              <span
                key={h}
                title={`${day(starts[d])} ${String(h).padStart(2, "0")}:00 · ${Math.round(m)} min`}
                className="h-[7px] rounded-[1px]"
                style={{
                  background: m > 0 ? color : "rgba(255,255,255,0.035)",
                  opacity: m > 0 ? 0.25 + 0.75 * Math.min(1, m / 60) : 1,
                  boxShadow: m >= 45 ? `0 0 6px ${color}` : undefined,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] pl-[31px]">
        {starts.map((s, i) => (
          <span key={s} className="dx-num flex-1 text-center text-[9px] text-dx-faint">
            {i % 5 === 4 || i === WINDOW_DAYS - 1 ? new Date(s).getDate() : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- detail pane */

function VisitorDetail({
  person,
  log,
  color,
  isHere,
  now,
  onChanged,
  onRemoved,
}: {
  person: Visitor;
  log: VisitLog;
  color: string;
  isHere: (id: string) => boolean;
  now: number;
  onChanged: () => Promise<unknown>;
  onRemoved: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [seen, setSeen] = useState(person.id);
  if (seen !== person.id) {
    setSeen(person.id);
    setName(person.name);
    setConfirm(false);
  }
  const visits = visitsOf(person.devices, log.sessions);
  const here = person.devices.some(isHere);
  const from = now - WINDOW_DAYS * DAY;
  const month = within(visits, from, now);
  const time = totalMs(month, from, now);
  const avg = month.length ? time / month.length : 0;
  const arrivals = month.map((v) => new Date(v.start).getHours() + new Date(v.start).getMinutes() / 60).sort((a, b) => a - b);
  const typical = arrivals.length ? arrivals[Math.floor(arrivals.length / 2)] : null;

  function save(changes: Partial<Visitor>) {
    setBusy(true);
    return saveVisitor({ ...person, ...changes })
      .then(onChanged)
      .catch(() => {})
      .finally(() => setBusy(false));
  }

  return (
    <Panel
      title="Visitor"
      icon={Users}
      accent={color}
      right={
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: here ? C.green : C.faint }}>
          <Dot color={here ? C.green : C.faint} pulse={here} /> {here ? "On the Wi-Fi now" : lastSeen(visits, false, now)}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[18px] font-bold text-black"
          style={{ background: color, boxShadow: `0 0 16px -4px ${color}` }}
        >
          {person.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <input
          aria-label="Name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== person.name && save({ name: name.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[22px] font-semibold tracking-[-0.3px] text-dx-text outline-none hover:border-dx-line focus:border-dx-cyan/50"
        />
        <label className="flex items-center gap-2 text-[11.5px] text-dx-dim">
          <Bell size={13} /> Alert on arrival
          <Switch on={person.notify} disabled={busy} color={C.violet} label="Alert on arrival" onChange={() => save({ notify: !person.notify })} />
        </label>
        <Btn
          color={confirm ? C.red : undefined}
          onClick={() => (confirm ? deleteVisitor(person.id).then(onChanged).then(onRemoved) : setConfirm(true))}
          title="Forget this visitor (their devices go back to New devices)"
        >
          <Trash2 size={11} /> {confirm ? "Confirm remove" : "Remove"}
        </Btn>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-4">
        <div>
          <Label>Visits · 30d</Label>
          <Big value={month.length} size={26} color={color} />
        </div>
        <div>
          <Label>Time · 30d</Label>
          <Big value={time ? dur(time) : "—"} size={22} />
        </div>
        <div>
          <Label>Avg visit</Label>
          <Big value={avg ? dur(avg) : "—"} size={22} />
        </div>
        <div>
          <Label>Usual arrival</Label>
          <Big value={typical === null ? "—" : `${String(Math.floor(typical)).padStart(2, "0")}:${String(Math.round((typical % 1) * 60)).padStart(2, "0")}`} size={22} />
        </div>
      </div>

      <div className="mt-4">
        <Label className="mb-1.5">When they're here · last {WINDOW_DAYS} days by hour</Label>
        <PresenceHeatmap visits={month} now={now} color={color} />
      </div>

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Label className="mb-1">Visit log</Label>
          <div className="dx-scroll max-h-[260px] overflow-y-auto pr-1">
            {visits.length === 0 && <div className="py-3 text-[12px] text-dx-dim">Nothing recorded yet.</div>}
            <table className="w-full text-[12px]">
              <tbody>
                {visits.slice(0, 80).map((v) => (
                  <tr key={v.start} className="border-b border-dashed border-dx-line last:border-0">
                    <td className="py-1.5 pr-3 text-dx-dim">{day(v.start)}</td>
                    <td className="dx-num px-2 text-dx-text">{hhmm(v.start)}</td>
                    <td className="dx-num px-2 text-dx-text">{v.end === null ? <span className="text-dx-green">now</span> : hhmm(v.end)}</td>
                    <td className="dx-num py-1.5 pl-2 text-right" style={{ color }}>
                      {dur((v.end ?? now) - v.start)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <Label className="mb-1">Devices</Label>
          {person.devices.map((d) => (
            <div key={d} className="flex items-center gap-2 border-b border-dashed border-dx-line py-1.5 text-[12px] last:border-0">
              <Smartphone size={13} style={{ color: isHere(d) ? C.green : C.faint }} />
              <span className="min-w-0 flex-1 truncate text-dx-text">{log.names[d] ?? d}</span>
              {person.devices.length > 1 && (
                <button
                  onClick={() => save({ devices: person.devices.filter((x) => x !== d) })}
                  aria-label="Remove device"
                  title="Remove this device from them"
                  className="text-dx-faint hover:text-dx-red"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          <p className="mt-2 text-[10.5px] leading-snug text-dx-faint">New phone? Assign it from New devices.</p>
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------- new devices */

function AssignRow({ entityId, log, onDone, onCancel }: { entityId: string; log: VisitLog; onDone: (id: string | null) => void; onCancel: () => void }) {
  const deviceName = log.names[entityId] ?? entityId;
  const guess = deviceName.match(/^(.+?)[-'’]s[- ]/i)?.[1]?.replace(/-/g, " ") ?? "";
  const [name, setName] = useState(guess);
  const [existing, setExisting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(work: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    work()
      .then(onDone)
      .catch((e: Error) => {
        setError(e.message);
        setBusy(false);
      });
  }

  return (
    <tr className="bg-dx-cyan/[0.04]">
      <td colSpan={5} className="px-2 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <input autoFocus className={clsx(INPUT, "w-48")} placeholder="New visitor's name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && run(() => saveVisitor({ name: name.trim(), devices: [entityId], notify: false }).then((p) => p.id))} />
          <Btn color={C.cyan} disabled={busy || !name.trim()} onClick={() => run(() => saveVisitor({ name: name.trim(), devices: [entityId], notify: false }).then((p) => p.id))}>
            {busy ? <Loader2 size={11} className="animate-spin" /> : <UserPlus size={11} />} Add visitor
          </Btn>
          {log.people.length > 0 && (
            <>
              <span className="text-[11px] text-dx-faint">or add to</span>
              <select value={existing} onChange={(e) => setExisting(e.target.value)} className={INPUT}>
                <option value="">Existing visitor…</option>
                {log.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Btn
                disabled={busy || !existing}
                onClick={() => {
                  const p = log.people.find((x) => x.id === existing)!;
                  run(() => saveVisitor({ ...p, devices: [...p.devices, entityId] }).then(() => p.id));
                }}
              >
                Assign
              </Btn>
            </>
          )}
          <span className="flex-1" />
          <Btn disabled={busy} onClick={() => run(() => hideDevice(entityId, true).then(() => null))} title="Not a visitor: hide it from this list">
            <EyeOff size={11} /> Not a visitor
          </Btn>
          <button onClick={onCancel} aria-label="Cancel" className="text-dx-faint hover:text-dx-text">
            <X size={14} />
          </button>
        </div>
        {error && <div className="mt-1.5 text-[11px] text-dx-red">{error}</div>}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ page */

export function VisitorsConsole() {
  const { entities } = useHa();
  const nowDate = useNow(60_000);
  const now = nowDate.getTime();
  const [log, setLog] = useState<VisitLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [params, setParams] = useSearchParams();
  const linked = params.get("device");

  const refresh = useCallback(
    () =>
      fetchVisitLog()
        .then((l) => {
          setLog(l);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (!log || !linked) return;
    setAssigning(linked);
    setParams({}, { replace: true });
  }, [log, linked, setParams]);

  const isHere = useCallback((id: string) => entities[id]?.state === "home", [entities]);
  const household = useMemo(
    () => new Set(HOUSEHOLD_PEOPLE.flatMap((p) => (entities[p]?.attributes.device_trackers as string[] | undefined) ?? [])),
    [entities],
  );

  const people = useMemo(() => {
    if (!log) return [];
    return log.people
      .map((p, i) => ({ person: p, visits: visitsOf(p.devices, log.sessions), here: p.devices.some(isHere), color: PALETTE[i % PALETTE.length] }))
      .sort((a, b) => Number(b.here) - Number(a.here) || (b.visits[0]?.start ?? 0) - (a.visits[0]?.start ?? 0));
  }, [log, isHere]);

  const newDevices = useMemo(() => {
    if (!log) return [];
    const named = new Set(log.people.flatMap((p) => p.devices));
    const cutoff = now - NEW_DEVICE_DAYS * DAY;
    return Object.entries(log.sessions)
      .filter(([id, list]) => !named.has(id) && !household.has(id) && !log.hidden.includes(id) && list.some((s) => (s.end ?? Infinity) >= cutoff))
      .map(([id]) => ({ id, name: log.names[id] ?? id, visits: visitsOf([id], log.sessions), here: isHere(id) }))
      .filter((d) => !(d.here && d.visits[0].end === null && now - d.visits[0].start > RESIDENT_DAYS * DAY))
      .sort((a, b) => Number(b.here) - Number(a.here) || b.visits[0].start - a.visits[0].start);
  }, [log, household, isHere, now]);

  if (!log) {
    return (
      <div className="dx-panel flex items-center gap-2 p-5 text-[12px] text-dx-dim">
        {error ? `Couldn't load the visit log: ${error}` : (
          <>
            <Loader2 size={14} className="animate-spin" /> Loading the visit log…
          </>
        )}
      </div>
    );
  }

  const from = now - WINDOW_DAYS * DAY;
  const sel = people.find((p) => p.person.id === selected) ?? people[0];
  const hereNow = people.filter((p) => p.here);
  const allMonth = people.flatMap((p) => within(p.visits, from, now));
  const totalTime = people.reduce((n, p) => n + totalMs(within(p.visits, from, now), from, now), 0);

  const kpis: { label: string; icon: typeof Users; value: React.ReactNode; unit?: string; color: string }[] = [
    { label: "Here now", icon: Users, value: hereNow.length, unit: hereNow.length ? hereNow.map((p) => p.person.name.split(" ")[0]).join(", ") : "nobody", color: C.green },
    { label: "Known visitors", icon: Users, value: log.people.length, color: C.cyan },
    { label: "Visits · 30d", icon: CalendarDays, value: allMonth.length, color: C.pink },
    { label: "Time · 30d", icon: Clock, value: totalTime ? dur(totalTime) : "—", color: C.violet },
    { label: "New devices", icon: Smartphone, value: newDevices.length, unit: "to triage", color: newDevices.length ? C.amber : C.faint },
    { label: "Dismissed", icon: EyeOff, value: log.hidden.length, color: C.faint },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((k, i) => (
          <div key={k.label} className="dx-panel dx-in relative overflow-hidden px-4 py-3" style={{ animationDelay: `${i * 30}ms` }}>
            <span className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${k.color}, transparent)` }} />
            <div className="flex items-center justify-between">
              <Label>{k.label}</Label>
              <k.icon size={13} style={{ color: k.color }} />
            </div>
            <div className="flex items-baseline gap-2">
              <Big value={k.value} size={26} />
              {k.unit && <span className="truncate text-[11px] text-dx-dim">{k.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-12">
        <div className="flex flex-col gap-3 xl:col-span-5">
          <Panel title="Roster" icon={Users} accent={C.cyan} delay={80} bodyClassName="p-0">
            {people.length === 0 ? (
              <div className="p-4 text-[12px] text-dx-dim">No visitors yet. Assign a device below to start.</div>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[9.5px] uppercase tracking-[0.14em] text-dx-faint">
                    <th className="px-4 pb-2 pt-3 font-semibold">Name</th>
                    <th className="px-2 pb-2 pt-3 font-semibold">Last seen</th>
                    <th className="px-2 pb-2 pt-3 text-right font-semibold">30d</th>
                    <th className="px-2 pb-2 pt-3 text-right font-semibold">Time</th>
                    <th className="px-4 pb-2 pt-3" />
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const m = within(p.visits, from, now);
                    const active = sel?.person.id === p.person.id;
                    return (
                      <tr
                        key={p.person.id}
                        onClick={() => setSelected(p.person.id)}
                        className={clsx("cursor-pointer border-t border-dashed border-dx-line transition-colors", active ? "bg-white/[0.04]" : "hover:bg-white/[0.02]")}
                      >
                        <td className="relative px-4 py-2">
                          {active && <span className="absolute inset-y-1 left-0 w-[3px] rounded-r" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }} />}
                          <div className="flex items-center gap-2">
                            <Dot color={p.here ? C.green : C.faint} pulse={p.here} />
                            <span className="truncate font-medium text-dx-text">{p.person.name}</span>
                          </div>
                        </td>
                        <td className="dx-num px-2 text-dx-dim" style={p.here ? { color: C.green } : undefined}>
                          {lastSeen(p.visits, p.here, now)}
                        </td>
                        <td className="dx-num px-2 text-right text-dx-text">{m.length}</td>
                        <td className="dx-num px-2 text-right text-dx-dim">{m.length ? dur(totalMs(m, from, now)) : "—"}</td>
                        <td className="px-4 text-right">{p.person.notify && <Bell size={12} className="inline text-dx-violet" />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel
            title="New devices"
            icon={Smartphone}
            accent={C.amber}
            delay={120}
            bodyClassName="p-0"
            right={<span className="text-[10.5px] text-dx-faint">seen in the last {NEW_DEVICE_DAYS} days</span>}
          >
            {newDevices.length === 0 ? (
              <div className="p-4 text-[12px] text-dx-dim">Nothing new to triage.</div>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[9.5px] uppercase tracking-[0.14em] text-dx-faint">
                    <th className="px-4 pb-2 pt-3 font-semibold">Device</th>
                    <th className="px-2 pb-2 pt-3 font-semibold">Last seen</th>
                    <th className="px-2 pb-2 pt-3 text-right font-semibold">Visits</th>
                    <th className="px-2 pb-2 pt-3 text-right font-semibold">Last stay</th>
                    <th className="px-4 pb-2 pt-3" />
                  </tr>
                </thead>
                <tbody>
                  {newDevices.map((d) =>
                    assigning === d.id ? (
                      <AssignRow
                        key={d.id}
                        entityId={d.id}
                        log={log}
                        onCancel={() => setAssigning(null)}
                        onDone={(personId) => {
                          setAssigning(null);
                          refresh().then(() => personId && setSelected(personId));
                        }}
                      />
                    ) : (
                      <tr key={d.id} className="group border-t border-dashed border-dx-line hover:bg-white/[0.02]">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <Smartphone size={13} style={{ color: d.here ? C.green : C.faint }} />
                            <span className="truncate text-dx-text">{d.name}</span>
                          </div>
                        </td>
                        <td className="dx-num px-2 text-dx-dim" style={d.here ? { color: C.green } : undefined}>
                          {d.here ? "here now" : `${dur(now - (d.visits[0].end ?? now))} ago`}
                        </td>
                        <td className="dx-num px-2 text-right text-dx-text">{d.visits.length}</td>
                        <td className="dx-num px-2 text-right text-dx-dim">{dur((d.visits[0].end ?? now) - d.visits[0].start)}</td>
                        <td className="px-4 py-1.5 text-right">
                          <Btn onClick={() => setAssigning(d.id)} className="opacity-70 group-hover:opacity-100">
                            <UserPlus size={11} /> Assign
                          </Btn>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            )}
            {log.hidden.length > 0 && (
              <div className="border-t border-dx-line px-4 py-2.5">
                <button onClick={() => setShowHidden((v) => !v)} className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dx-faint hover:text-dx-text">
                  {showHidden ? "▾" : "▸"} {log.hidden.length} dismissed
                </button>
                {showHidden && (
                  <div className="mt-2">
                    {log.hidden.map((id) => (
                      <div key={id} className="flex items-center gap-2 border-b border-dashed border-dx-line py-1.5 text-[12px] last:border-0">
                        <span className="min-w-0 flex-1 truncate text-dx-dim">{log.names[id] ?? id}</span>
                        <Btn onClick={() => hideDevice(id, false).then(refresh)}>Restore</Btn>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        <div className="xl:col-span-7">
          {sel ? (
            <VisitorDetail
              person={sel.person}
              log={log}
              color={sel.color}
              isHere={isHere}
              now={now}
              onChanged={refresh}
              onRemoved={() => setSelected(null)}
            />
          ) : (
            <div className="dx-panel p-6 text-[12px] text-dx-dim">Pick a visitor to see their history.</div>
          )}
        </div>
      </div>

      {people.length > 0 && (
        <Panel title={`All visits · ${WINDOW_DAYS} days`} icon={History} accent={C.pink} delay={160}>
          <Timeline
            hours={WINDOW_DAYS * 24}
            start={from}
            end={now}
            rows={people.map((p) => {
              const m = within(p.visits, from, now);
              return { label: p.person.name, spans: m.map((v) => ({ start: v.start, end: v.end ?? now })), color: p.color, right: `${m.length}×` };
            })}
          />
        </Panel>
      )}
    </>
  );
}
