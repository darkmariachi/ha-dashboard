import clsx from "clsx";
import { Bell, BellOff, Loader2, Smartphone, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HOUSEHOLD_PEOPLE } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import {
  clock,
  dayLabel,
  deleteVisitor,
  duration,
  fetchVisitLog,
  hideDevice,
  saveVisitor,
  visitsOf,
  type Session,
  type VisitLog,
  type Visitor,
} from "../../lib/visitors";
import { Sheet } from "../home/Sheet";

const HOME_GREEN = "#3ee08f";
const ACCENT = "#4f79c9";
/** New devices only list ones that came by this recently... */
const NEW_DEVICE_DAYS = 30;
/** ...and not ones that have stayed this long: those live here. */
const RESIDENT_DAYS = 2;
const DAY_MS = 86_400_000;

const INPUT =
  "w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm text-text outline-none focus:border-accent";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="hero-shadow mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85 first:mt-0">
      {children}
    </h2>
  );
}

function Initial({ name, here }: { name: string; here: boolean }) {
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[17px] font-semibold"
      style={{ background: "var(--chip-off)", color: here ? HOME_GREEN : "var(--color-text-dim)" }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** "Here since 6:40 PM" / "Last here yesterday · 3 h" / "Not seen yet". */
function lastSeenText(visits: Session[], here: boolean, now: Date) {
  const v = visits[0];
  if (here) return v ? `Here since ${clock(v.start)}${dayLabel(v.start, now) === "today" ? "" : ` ${dayLabel(v.start, now)}`}` : "Here now";
  if (!v) return "Not seen yet";
  return `Last here ${dayLabel(v.start, now)} · ${duration((v.end ?? now.getTime()) - v.start)}`;
}

/**
 * The phone's Visitors tab: friends' and family's phones on the Wi-Fi.
 * "Here now" comes live from HA's UniFi trackers; arrival times and the
 * history come from the push service's visit log (push/visits.mjs), which
 * keeps far more than HA's 10 days. Unnamed devices that came by recently
 * are listed so they can be named (or dismissed) right here.
 */
export function VisitorsPanel() {
  const { entities } = useHa();
  const now = useNow(60_000);
  const [log, setLog] = useState<VisitLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

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

  const isHere = useCallback((id: string) => entities[id]?.state === "home", [entities]);

  const household = useMemo(
    () => new Set(HOUSEHOLD_PEOPLE.flatMap((p) => (entities[p]?.attributes.device_trackers as string[] | undefined) ?? [])),
    [entities],
  );

  const people = useMemo(() => {
    if (!log) return [];
    return log.people
      .map((p) => ({ person: p, visits: visitsOf(p.devices, log.sessions), here: p.devices.some(isHere) }))
      .sort((a, b) => (a.visits[0]?.start ?? 0) < (b.visits[0]?.start ?? 0) ? 1 : -1);
  }, [log, isHere]);

  const newDevices = useMemo(() => {
    if (!log) return [];
    const named = new Set(log.people.flatMap((p) => p.devices));
    const cutoff = now.getTime() - NEW_DEVICE_DAYS * DAY_MS;
    return Object.entries(log.sessions)
      .filter(([id, list]) => !named.has(id) && !household.has(id) && !log.hidden.includes(id) && list.some((s) => (s.end ?? Infinity) >= cutoff))
      .map(([id]) => ({ id, name: log.names[id] ?? id, visits: visitsOf([id], log.sessions), here: isHere(id) }))
      .filter((d) => !(d.here && d.visits[0].end === null && now.getTime() - d.visits[0].start > RESIDENT_DAYS * DAY_MS))
      .sort((a, b) => Number(b.here) - Number(a.here) || b.visits[0].start - a.visits[0].start);
  }, [log, household, isHere, now]);

  if (!log) {
    return (
      <div className="glass rise flex items-center gap-2 rounded-[26px] p-5 text-sm text-text-dim">
        {error ? `Couldn't load visitors: ${error}` : (
          <>
            <Loader2 size={16} className="animate-spin" /> Loading visitors…
          </>
        )}
      </div>
    );
  }

  const here = people.filter((p) => p.here);
  const away = people.filter((p) => !p.here);
  const person = log.people.find((p) => p.id === openPerson);
  let delay = 100;
  const rise = () => ({ animationDelay: `${(delay += 50)}ms` });

  return (
    <>
      <SectionTitle>Here now</SectionTitle>
      {here.length === 0 ? (
        <div className="glass rise rounded-[26px] px-5 py-4 text-sm text-text-dim" style={rise()}>
          No visitors right now.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {here.map(({ person: p, visits }) => (
            <PersonRow key={p.id} person={p} text={lastSeenText(visits, true, now)} here style={rise()} onOpen={() => setOpenPerson(p.id)} />
          ))}
        </div>
      )}

      {away.length > 0 && (
        <>
          <SectionTitle>Recently</SectionTitle>
          <div className="flex flex-col gap-3">
            {away.map(({ person: p, visits }) => (
              <PersonRow key={p.id} person={p} text={lastSeenText(visits, false, now)} here={false} style={rise()} onOpen={() => setOpenPerson(p.id)} />
            ))}
          </div>
        </>
      )}

      {newDevices.length > 0 && (
        <>
          <SectionTitle>New devices</SectionTitle>
          <div className="glass rise flex flex-col rounded-[26px] p-2" style={rise()}>
            {newDevices.map((d) => (
              <button
                key={d.id}
                onClick={() => setNaming(d.id)}
                className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left active:bg-chip"
              >
                <Smartphone size={18} className="shrink-0" style={{ color: d.here ? HOME_GREEN : "var(--color-text-dim)" }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text">{d.name}</div>
                  <div className="text-xs text-text-dim">
                    {lastSeenText(d.visits, d.here, now)} · {d.visits.length} {d.visits.length === 1 ? "visit" : "visits"}
                  </div>
                </div>
                <UserPlus size={17} className="shrink-0 text-text-dim" />
              </button>
            ))}
          </div>
        </>
      )}

      {log.people.length === 0 && (
        <p className="hero-shadow mt-3 text-center text-xs text-white/75">
          Tap a device to say whose phone it is. Visits from the last 10 days come along.
        </p>
      )}

      {log.hidden.length > 0 && (
        <div className="mt-4 text-center">
          <button onClick={() => setShowHidden((v) => !v)} className="hero-shadow text-xs font-semibold text-white/75">
            {showHidden ? "Hide" : "Show"} {log.hidden.length} dismissed {log.hidden.length === 1 ? "device" : "devices"}
          </button>
          {showHidden && (
            <div className="glass mt-2 flex flex-col rounded-[26px] p-2 text-left">
              {log.hidden.map((id) => (
                <div key={id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{log.names[id] ?? id}</span>
                  <button
                    onClick={() => hideDevice(id, false).then(refresh)}
                    className="rounded-full bg-chip px-3 py-1 text-xs font-semibold text-text"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {person && (
        <PersonSheet
          person={person}
          log={log}
          isHere={isHere}
          now={now}
          onClose={() => setOpenPerson(null)}
          onChanged={refresh}
        />
      )}
      {naming && (
        <NameDeviceSheet
          entityId={naming}
          log={log}
          onClose={() => setNaming(null)}
          onDone={(personId) => {
            setNaming(null);
            refresh().then(() => personId && setOpenPerson(personId));
          }}
        />
      )}
    </>
  );
}

function PersonRow({
  person,
  text,
  here,
  style,
  onOpen,
}: {
  person: Visitor;
  text: string;
  here: boolean;
  style: React.CSSProperties;
  onOpen: () => void;
}) {
  return (
    <button onClick={onOpen} className="glass rise flex items-center gap-3 rounded-[26px] p-4 text-left active:scale-[0.99]" style={style}>
      <Initial name={person.name} here={here} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-semibold tracking-[-0.2px] text-text">{person.name}</div>
        <div className="text-[13px]" style={{ color: here ? HOME_GREEN : "var(--color-text-dim)" }}>
          {text}
        </div>
      </div>
      {person.notify && <Bell size={15} className="shrink-0 text-text-dim" />}
    </button>
  );
}

/** A visitor's history, grouped by day, plus their settings. */
function PersonSheet({
  person,
  log,
  isHere,
  now,
  onClose,
  onChanged,
}: {
  person: Visitor;
  log: VisitLog;
  isHere: (id: string) => boolean;
  now: Date;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [name, setName] = useState(person.name);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const visits = visitsOf(person.devices, log.sessions);
  const here = person.devices.some(isHere);
  const month = visits.filter((v) => (v.end ?? now.getTime()) >= now.getTime() - 30 * DAY_MS);
  const monthTime = month.reduce((sum, v) => sum + ((v.end ?? now.getTime()) - v.start), 0);
  const shown = showAll ? visits : visits.slice(0, 20);

  // Group by the day each visit started.
  const days: { label: string; visits: Session[] }[] = [];
  for (const v of shown) {
    const label = new Date(v.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (days[days.length - 1]?.label === label) days[days.length - 1].visits.push(v);
    else days.push({ label, visits: [v] });
  }

  function save(changes: Partial<Visitor>) {
    setBusy(true);
    return saveVisitor({ ...person, ...changes })
      .then(onChanged)
      .catch(() => {})
      .finally(() => setBusy(false));
  }

  return (
    <Sheet
      title={person.name}
      subtitle={
        <span style={{ color: here ? HOME_GREEN : undefined }}>
          {here ? "Here now" : visits.length ? `${month.length} ${month.length === 1 ? "visit" : "visits"} in the last 30 days${month.length ? ` · ${duration(monthTime)} total` : ""}` : "No visits yet"}
        </span>
      }
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        {days.length === 0 && <div className="rounded-2xl bg-chip px-4 py-3 text-sm text-text-dim">Nothing recorded yet.</div>}
        {days.map((d) => (
          <div key={d.label}>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">{d.label}</div>
            <div className="flex flex-col gap-1 rounded-2xl bg-chip px-4 py-2.5">
              {d.visits.map((v) => (
                <div key={v.start} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-text">
                    {clock(v.start)} – {v.end === null ? <span style={{ color: HOME_GREEN }}>now</span> : clock(v.end)}
                  </span>
                  <span className="text-text-dim">{duration((v.end ?? now.getTime()) - v.start)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {visits.length > shown.length && (
          <button onClick={() => setShowAll(true)} className="text-sm font-semibold" style={{ color: ACCENT }}>
            Show all {visits.length} visits
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">Name</span>
          <input
            className={INPUT}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== person.name && save({ name: name.trim() })}
          />
        </label>

        <button
          onClick={() => save({ notify: !person.notify })}
          disabled={busy}
          className="flex items-center gap-3 rounded-2xl bg-chip px-4 py-3 text-left text-sm text-text"
        >
          {person.notify ? <Bell size={18} style={{ color: ACCENT }} /> : <BellOff size={18} className="text-text-dim" />}
          <span className="flex-1">Notify when {person.name} arrives</span>
          <span className={clsx("text-xs font-semibold", person.notify ? "" : "text-text-dim")} style={person.notify ? { color: ACCENT } : undefined}>
            {person.notify ? "On" : "Off"}
          </span>
        </button>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">Devices</div>
          <div className="flex flex-col rounded-2xl bg-chip">
            {person.devices.map((d) => (
              <div key={d} className="flex items-center gap-3 px-4 py-2.5">
                <Smartphone size={16} style={{ color: isHere(d) ? HOME_GREEN : "var(--color-text-dim)" }} />
                <span className="min-w-0 flex-1 truncate text-sm text-text">{log.names[d] ?? d}</span>
                {person.devices.length > 1 && (
                  <button onClick={() => save({ devices: person.devices.filter((x) => x !== d) })} aria-label="Remove device" className="text-text-dim">
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-text-dim">New phone? Tap it under New devices and add it to {person.name}.</p>
        </div>

        <button
          onClick={() => (confirmDelete ? deleteVisitor(person.id).then(onChanged).then(onClose) : setConfirmDelete(true))}
          className="flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-[#ff6b6b]"
        >
          <Trash2 size={15} />
          {confirmDelete ? `Tap again to remove ${person.name}` : "Remove visitor"}
        </button>
      </div>
    </Sheet>
  );
}

/** "Whose phone is this?" — a new visitor, an existing one, or not a
 * visitor at all (dismissed from the list). */
function NameDeviceSheet({
  entityId,
  log,
  onClose,
  onDone,
}: {
  entityId: string;
  log: VisitLog;
  onClose: () => void;
  onDone: (personId: string | null) => void;
}) {
  const deviceName = log.names[entityId] ?? entityId;
  // "Carlos-s-S23" -> "Carlos" as a starting guess.
  const guess = deviceName.match(/^(.+?)[-'’]s[- ]/i)?.[1]?.replace(/-/g, " ") ?? "";
  const [name, setName] = useState(guess);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visits = visitsOf([entityId], log.sessions);

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
    <Sheet title="Whose phone is this?" subtitle={`${deviceName} · ${visits.length} ${visits.length === 1 ? "visit" : "visits"}`} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <input className={INPUT} placeholder="Name" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        <button
          onClick={() => run(() => saveVisitor({ name: name.trim(), devices: [entityId], notify: false }).then((p) => p.id))}
          disabled={busy || !name.trim()}
          className="flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
          style={{ background: ACCENT }}
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          Add visitor
        </button>
      </div>

      {log.people.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">Or add it to</div>
          <div className="flex flex-wrap gap-2">
            {log.people.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => run(() => saveVisitor({ ...p, devices: [...p.devices, entityId] }).then(() => p.id))}
                className="rounded-full bg-chip px-3.5 py-2 text-sm font-semibold text-text"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="text-sm text-[#ff6b6b]">{error}</div>}

      <button
        onClick={() => run(() => hideDevice(entityId, true).then(() => null))}
        disabled={busy}
        className="rounded-full py-2.5 text-sm font-semibold text-text-dim"
      >
        Not a visitor — hide it
      </button>
    </Sheet>
  );
}
