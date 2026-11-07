import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, EyeOff, ImagePlus, Link2, Loader2, ScanFace, Smartphone, Sparkles, Star, Trash2, Wifi, X } from "lucide-react";
import { DeleteFaceSheet, FaceViewer } from "./FaceViewer";
import { Sheet } from "../home/Sheet";
import {
  HOUSEHOLD,
  IGNORE,
  assignFaces,
  camLabel,
  deleteFaces,
  faceClusters,
  faceStatus,
  faceCandidates,
  facesOf,
  rejectFaces,
  setAvatar,
  subjectName,
  suggestFor,
  uploadPhotos,
  type Candidate,
  type Face,
  type FaceCluster,
  type FaceStatus,
} from "../../lib/faces";
import { avatarsChanged, useAvatars, useHouseholdNames } from "../../lib/useFaceNames";
import { useNow } from "../../lib/useNow";
import { deviceSuggestions, saveVisitor, type Session, type VisitLog, type Visitor } from "../../lib/visitors";

// Touch versions of the desktop face tools, in the phone / tablet glass
// style: name the unknown face groups the face service found, and see /
// confirm / add a visitor's faces.

const ACCENT = "#4f79c9";
const HOME_GREEN = "#2fae7e";
const NEW_VISITOR = "__new_visitor";
const NEW_HOUSEHOLD = "__household_other";

function day(t: number) {
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Who is this?" with the phone's own picker, then Save. */
function WhoSelect({
  log,
  suggestion,
  busy,
  onPick,
  onIgnore,
}: {
  log: VisitLog;
  suggestion?: string;
  busy: boolean;
  onPick: (subject: string) => void;
  /** Shows a quick Ignore button beside Save. */
  onIgnore?: () => void;
}) {
  const household = useHouseholdNames();
  const [value, setValue] = useState(suggestion ?? "");
  // Whatever is selected (e.g. a pre-selected hint) must be an option, or
  // the menu shows "Who is this?" while Save would use the hidden value.
  const known = new Set([
    "",
    NEW_VISITOR,
    NEW_HOUSEHOLD,
    IGNORE,
    ...log.people.map((p) => p.id),
    ...household.map((n) => `${HOUSEHOLD}${n}`),
  ]);
  const [name, setName] = useState("");
  const naming = value === NEW_VISITOR || value === NEW_HOUSEHOLD;

  async function save() {
    if (value === NEW_VISITOR) {
      if (!name.trim()) return;
      const p = await saveVisitor({ name: name.trim(), devices: [], notify: false });
      onPick(p.id);
    } else if (value === NEW_HOUSEHOLD) {
      if (name.trim()) onPick(`${HOUSEHOLD}${name.trim()}`);
    } else if (value) onPick(value);
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm text-text outline-none focus:border-accent"
      >
        <option value="">Who is this?</option>
        {value && !known.has(value) && <option value={value}>{subjectName(value, log)}</option>}
        {log.people.length > 0 && (
          <optgroup label="Visitors">
            {log.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Household">
          {household.map((n) => (
            <option key={n} value={`${HOUSEHOLD}${n}`}>
              {n}
            </option>
          ))}
          <option value={NEW_HOUSEHOLD}>Someone else in the household…</option>
        </optgroup>
        <option value={NEW_VISITOR}>New visitor…</option>
        <option value={IGNORE}>Not useful — ignore</option>
      </select>
      {naming && (
        <input
          autoFocus
          value={name}
          maxLength={40}
          placeholder="Name"
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm text-text outline-none focus:border-accent"
        />
      )}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy || !value || (naming && !name.trim())}
          className="flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-40"
          style={{ background: ACCENT }}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          Save
        </button>
        {onIgnore && (
          <button
            onClick={onIgnore}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 rounded-full bg-chip px-4 py-2.5 text-sm font-semibold text-text-dim transition-transform active:scale-95 disabled:opacity-40"
          >
            <EyeOff size={15} /> Ignore
          </button>
        )}
      </div>
    </div>
  );
}

/** "Ignore these faces?" — hidden from review and never matched to anyone. */
function IgnoreSheet({ count, onConfirm, onClose }: { count: number; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet title={`Ignore ${count === 1 ? "this face" : `these ${count} faces`}?`} subtitle="They'll leave Faces to review and won't be matched to anyone." onClose={onClose}>
      <p className="text-sm text-text-dim">
        For strangers, delivery drivers and bad captures. Faces that closely resemble these will be hidden automatically too, so it's best not to use it
        for someone you might want to name later.
      </p>
      <div className="flex gap-2 pb-1">
        <button onClick={onClose} className="flex-1 rounded-full bg-chip py-3 text-sm font-semibold text-text active:scale-95">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white active:scale-95"
          style={{ background: "#d14d5b" }}
        >
          <EyeOff size={16} /> Ignore
        </button>
      </div>
    </Sheet>
  );
}

function ClusterCard({ cluster, log, now, onDone }: { cluster: FaceCluster; log: VisitLog; now: number; onDone: () => void }) {
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmIgnore, setConfirmIgnore] = useState(false);
  const [viewing, setViewing] = useState<Face | null>(null);
  const [deleting, setDeleting] = useState<Face | null>(null);
  const hint = useMemo(() => suggestFor(cluster, log, now), [cluster, log, now]);
  const looks = cluster.nearest && cluster.nearest.subject !== hint?.id ? cluster.nearest : null;
  const days = new Set(cluster.times.map((t) => new Date(t).toDateString())).size;
  const first = cluster.times[0];
  const last = cluster.times.at(-1)!;

  async function pick(subject: string) {
    setBusy(true);
    setError(null);
    try {
      await assignFaces(
        cluster.ids.filter((id) => !excluded.has(id)),
        subject,
      );
      navigator.vibrate?.(10);
      avatarsChanged();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="glass rise flex flex-col gap-3 rounded-[26px] p-4">
      <div className="grid grid-cols-4 gap-1.5">
        {cluster.faces.slice(0, 8).map((f) => {
          const out = excluded.has(f.id);
          return (
            <div key={f.id} className="relative aspect-square">
              <button
                onClick={() => setViewing(f)}
                aria-label="See this face up close"
                className="h-full w-full overflow-hidden rounded-xl bg-black/40"
              >
                <img src={f.crop} alt="" className={clsx("h-full w-full object-cover", out && "opacity-25 grayscale")} />
                {out && (
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-semibold text-white">left out</span>
                )}
              </button>
              <button
                onClick={() => setDeleting(f)}
                aria-label="Delete this face"
                className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white shadow active:scale-90"
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="text-[13px] text-text-dim">
        <span className="font-semibold text-text">Seen {cluster.ids.length}×</span> · {days} {days === 1 ? "day" : "days"} ·{" "}
        {day(first)}
        {days > 1 && `–${day(last)}`} · {cluster.cameras.map(camLabel).join(", ")}
      </div>
      {hint && (
        <div className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: HOME_GREEN }}>
          <Wifi size={14} /> {hint.name}'s phone was on the Wi-Fi for {hint.hits} of these
        </div>
      )}
      {looks && (
        <div className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: ACCENT }}>
          <Sparkles size={14} /> Looks like {subjectName(looks.subject, log)} ({Math.round(looks.score * 100)}% similar)
        </div>
      )}
      {excluded.size > 0 && <div className="text-xs text-text-dim">{excluded.size} left out of the group — tap it to put it back.</div>}
      <WhoSelect log={log} suggestion={hint?.id ?? looks?.subject} busy={busy} onPick={pick} onIgnore={() => setConfirmIgnore(true)} />
      {error && <div className="text-xs text-[#ff6b6b]">{error}</div>}
      {viewing && (
        <FaceViewer face={viewing} onClose={() => setViewing(null)}>
          <button
            onClick={() => {
              setExcluded((s) => {
                const n = new Set(s);
                if (n.has(viewing.id)) n.delete(viewing.id);
                else n.add(viewing.id);
                return n;
              });
              setViewing(null);
            }}
            className="flex-1 rounded-full bg-chip py-3 text-sm font-semibold text-text active:scale-95"
          >
            {excluded.has(viewing.id) ? "Put back in the group" : "Leave out of this group"}
          </button>
          <button
            onClick={() => {
              setDeleting(viewing);
              setViewing(null);
            }}
            className="flex items-center justify-center gap-1.5 rounded-full bg-chip px-5 py-3 text-sm font-semibold text-[#ff6b6b] active:scale-95"
          >
            <Trash2 size={15} /> Delete
          </button>
        </FaceViewer>
      )}
      {deleting && (
        <DeleteFaceSheet
          face={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const id = deleting.id;
            setDeleting(null);
            await deleteFaces([id]).catch((e: Error) => setError(e.message));
            avatarsChanged();
            onDone();
          }}
        />
      )}
      {confirmIgnore && (
        <IgnoreSheet
          count={cluster.ids.length - excluded.size}
          onClose={() => setConfirmIgnore(false)}
          onConfirm={() => {
            setConfirmIgnore(false);
            pick(IGNORE);
          }}
        />
      )}
    </div>
  );
}

/** "Faces to review" for the phone's Visitors tab (and the tablet page). */
export function FaceReviewSection({ log, onChanged, title }: { log: VisitLog; onChanged: () => void; title: (text: React.ReactNode) => React.ReactNode }) {
  const now = useNow(60_000).getTime();
  const [clusters, setClusters] = useState<FaceCluster[] | null>(null);
  const [status, setStatus] = useState<FaceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(8);

  const load = useCallback(() => {
    faceStatus()
      .then(setStatus)
      .catch(() => {});
    faceClusters(limit)
      .then((c) => {
        setClusters(c);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [limit]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const pending = status?.queue.pending ?? 0;
  const done = status?.queue.done ?? 0;
  const unknown = status?.faces.unknown ?? 0;

  return (
    <>
      {title(
        <span className="flex items-center gap-2">
          <ScanFace size={13} /> Faces to review{unknown ? ` · ${unknown}` : ""}
        </span>,
      )}
      {pending > 0 && (
        <div className="hero-shadow mb-2 flex items-center gap-2 text-xs text-white/80">
          <Loader2 size={13} className="animate-spin" /> Scanning past camera detections · {done} of {done + pending}
        </div>
      )}
      {error && !clusters ? (
        <div className="glass rounded-[26px] px-5 py-4 text-sm text-text-dim">Couldn't reach the face service: {error}</div>
      ) : !clusters ? (
        <div className="glass h-40 animate-pulse rounded-[26px]" />
      ) : clusters.length === 0 ? (
        <div className="glass rounded-[26px] px-5 py-4 text-sm text-text-dim">
          {pending > 0 ? "Faces show up here as they're found." : "Every face found so far has a name."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="hero-shadow text-xs text-white/80">
            Faces from the front door, grouped by likeness. Name a group once and later sightings are matched automatically. Tap a face to leave
            it out.
          </p>
          {clusters.map((c) => (
            <ClusterCard
              key={c.ids[0]}
              cluster={c}
              log={log}
              now={now}
              onDone={() => {
                onChanged();
                load();
              }}
            />
          ))}
          {clusters.length >= limit && (
            <button onClick={() => setLimit((l) => l + 8)} className="hero-shadow py-2 text-sm font-semibold text-white/85">
              Show more
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** Unnamed faces from while this visitor's phone was on the Wi-Fi, best
 * likeness first: tap to pick, then say whether it's them. */
function VisitSuggestions({ subject, name, visits, onChanged }: { subject: string; name: string; visits: Session[]; onChanged: () => void }) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const first = name.split(" ")[0];
  const visitsKey = visits.map((v) => `${v.start}-${v.end}`).join(",");

  const load = useCallback(() => {
    faceCandidates(subject, visits, Date.now())
      .then(setList)
      .catch(() => setList([]));
    // visitsKey stands in for visits (a new array every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, visitsKey]);
  useEffect(load, [load]);

  if (!list || list.length === 0) return null;

  async function answer(yes: boolean) {
    const ids = [...picked];
    setBusy(true);
    await (yes ? assignFaces(ids, subject) : rejectFaces(subject, ids)).catch(() => {});
    navigator.vibrate?.(10);
    setPicked(new Set());
    setBusy(false);
    avatarsChanged();
    load();
    onChanged();
  }

  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-chip p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <Wifi size={14} style={{ color: HOME_GREEN }} /> While {first}'s phone was here · {list.length}
        </div>
        <button
          onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((f) => f.id)))}
          className="text-xs font-semibold"
          style={{ color: ACCENT }}
        >
          {picked.size === list.length ? "Clear" : "Select all"}
        </button>
      </div>
      <p className="text-xs text-text-dim">
        Unnamed faces from the front door during {first}'s visits
        {list.some((f) => f.sim !== null) ? ", most like them first" : ""}. Tap the ones that are {first}.
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {list.map((f) => {
          const on = picked.has(f.id);
          return (
            <button
              key={f.id}
              onClick={() => toggle(f.id)}
              aria-pressed={on}
              className={clsx("relative aspect-square overflow-hidden rounded-xl bg-black/40", on && "ring-[3px]")}
              style={on ? ({ "--tw-ring-color": HOME_GREEN } as React.CSSProperties) : undefined}
            >
              <img src={f.crop} alt="" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-[9.5px] font-semibold text-white">
                {day(f.t)}
                {f.sim !== null && ` · ${Math.round(f.sim * 100)}%`}
              </span>
              {on && (
                <span className="absolute right-1 top-1 rounded-full p-0.5" style={{ background: HOME_GREEN }}>
                  <Check size={12} className="text-white" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {picked.size > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => answer(true)}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
            style={{ background: HOME_GREEN }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} It's {first} ({picked.size})
          </button>
          <button
            onClick={() => answer(false)}
            disabled={busy}
            className="flex-1 rounded-full bg-surface py-2.5 text-sm font-semibold text-[#ff6b6b] active:scale-95 disabled:opacity-50"
          >
            Not {first}
          </button>
        </div>
      )}
    </div>
  );
}

/** A visitor's faces in their sheet: confirm or reject automatic matches,
 * add reference photos from the camera roll, and pick from faces seen
 * while their phone was on the Wi-Fi. */
export function PersonFaces({ subject, name, visits = [] }: { subject: string; name: string; visits?: Session[] }) {
  const avatar = useAvatars()[subject];
  const [faces, setFaces] = useState<Face[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [viewing, setViewing] = useState<Face | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    facesOf(subject, 36)
      .then(setFaces)
      .catch(() => setFaces([]));
  }, [subject]);
  useEffect(load, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);
    setMessage(await uploadPhotos(subject, files));
    setBusy(false);
    load();
  }

  /** "Not them": recorded, so automatic matching won't put it back. */
  async function notThem(id: number) {
    setOpen(null);
    await rejectFaces(subject, [id]).catch(() => {});
    avatarsChanged();
    load();
  }

  async function set(id: number, to: string | null) {
    setOpen(null);
    await assignFaces([id], to).catch(() => {});
    avatarsChanged();
    load();
  }

  async function profile(id: number | null) {
    await setAvatar(subject, id).catch(() => {});
    avatarsChanged();
  }

  const seen = faces?.find((f) => f.camera !== "upload");
  const selected = faces?.find((f) => f.id === open);

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">
        Faces{faces?.length ? ` · ${faces.length}` : ""}
        {seen && (
          <span className="font-normal normal-case tracking-normal">
            · last at the {camLabel(seen.camera).toLowerCase()} {new Date(seen.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
      </h3>
      {!faces ? (
        <div className="h-16 animate-pulse rounded-2xl bg-chip" />
      ) : faces.length === 0 ? (
        <div className="rounded-2xl bg-chip px-4 py-3 text-sm text-text-dim">No faces yet — name a group under Faces to review, or add photos.</div>
      ) : (
        <div className="grid grid-cols-5 gap-1.5">
          {faces.map((f) => (
            <button
              key={f.id}
              onClick={() => setOpen(open === f.id ? null : f.id)}
              className={clsx(
                "relative aspect-square overflow-hidden rounded-xl border-2 bg-black/40",
                f.label === "auto" ? "border-dashed" : "border-solid",
                open === f.id && "ring-2 ring-offset-1",
              )}
              style={{ borderColor: f.label === "auto" ? `${ACCENT}99` : ACCENT }}
            >
              <img src={f.crop} alt="" className="h-full w-full object-cover" />
              {avatar?.avatar_id === f.id && (
                <span className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5" title="Profile picture">
                  <Star size={11} className="fill-[#ffcf5a] text-[#ffcf5a]" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="flex items-center gap-2 rounded-2xl bg-chip px-3 py-2.5 text-sm">
          <span className="min-w-0 flex-1 text-text-dim">
            {camLabel(selected.camera)} · {new Date(selected.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {selected.label === "auto" && ` · matched ${Math.round(selected.score * 100)}%`}
          </span>
          <button onClick={() => setViewing(selected)} className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-text">
            View
          </button>
          {selected.label === "auto" && (
            <button onClick={() => set(selected.id, subject)} className="rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ background: HOME_GREEN }}>
              It's {name.split(" ")[0]}
            </button>
          )}
          <button onClick={() => notThem(selected.id)} className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-[#ff6b6b]">
            Not {name.split(" ")[0]}
          </button>
        </div>
      )}
      {selected && (
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-chip px-3 py-2.5 text-sm">
          <span className="flex items-center gap-1.5 text-text-dim">
            <Star size={14} className={avatar?.avatar_id === selected.id ? "fill-[#ffcf5a] text-[#ffcf5a]" : ""} />
            {avatar?.avatar_id === selected.id ? (avatar.avatar_chosen ? "Profile picture" : "Profile picture (latest)") : "Profile picture"}
          </span>
          {avatar?.avatar_id === selected.id ? (
            avatar.avatar_chosen && (
              <button onClick={() => profile(null)} className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-text">
                Use latest instead
              </button>
            )
          ) : (
            <button onClick={() => profile(selected.id)} className="rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ background: ACCENT }}>
              Use this one
            </button>
          )}
        </div>
      )}
      {visits.length > 0 && <VisitSuggestions subject={subject} name={name} visits={visits} onChanged={load} />}
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files).finally(() => (e.target.value = ""))} />
      <button
        onClick={() => file.current?.click()}
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-2xl bg-chip px-4 py-3 text-sm font-semibold text-text active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} style={{ color: ACCENT }} />}
        Add photos of {name.split(" ")[0]}
      </button>
      {message && <p className="text-xs text-text-dim">{message}</p>}
      {faces && faces.some((f) => f.label === "auto") && (
        <p className="text-xs text-text-dim">Dashed faces were matched automatically. Tap one to confirm or reject it.</p>
      )}
      {viewing && <FaceViewer face={viewing} detail={viewing.label === "auto" ? <div>Matched {Math.round(viewing.score * 100)}%</div> : null} onClose={() => setViewing(null)} />}
    </section>
  );
}

/**
 * The reverse of the Wi-Fi face suggestions: unlinked phones that were on
 * the Wi-Fi while this person was seen at the door. One tap links it, after
 * which their Wi-Fi visits count too.
 */
export function DeviceSuggestions({
  person,
  log,
  seen,
  household,
  now,
  onChanged,
}: {
  person: Visitor;
  log: VisitLog;
  seen: Record<string, number[]>;
  household: Set<string>;
  now: number;
  onChanged: () => Promise<unknown> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const list = useMemo(() => deviceSuggestions(person, log, seen, household, now), [person, log, seen, household, now]);
  if (list.length === 0) return null;
  const first = person.name.split(" ")[0];

  async function link(id: string) {
    setBusy(id);
    await saveVisitor({ ...person, devices: [...person.devices, id] }).catch(() => {});
    navigator.vibrate?.(10);
    await onChanged();
    setBusy(null);
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-2xl p-3" style={{ background: "var(--chip-off)" }}>
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
        <ScanFace size={14} style={{ color: ACCENT }} /> Phones here when {first} was at the door
      </div>
      {list.map((d) => (
        <div key={d.id} className="flex items-center gap-3">
          <Smartphone size={16} className="shrink-0 text-text-dim" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text">{d.name}</div>
            <div className="text-xs text-text-dim">
              {d.lastSeenAt
                ? `Last on the Wi-Fi ${new Date(d.lastSeenAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, right after ${first} was seen`
                : `On the Wi-Fi ${d.hits} of ${d.of} ${d.of === 1 ? "time" : "times"} ${first} was seen · ${d.visits} ${d.visits === 1 ? "visit" : "visits"} overall`}
            </div>
          </div>
          <button
            onClick={() => link(d.id)}
            disabled={busy !== null}
            className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-white active:scale-95 disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            {busy === d.id ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Link
          </button>
        </div>
      ))}
    </div>
  );
}

/** The household's people for the Visitors tab: each with their face
 * count and last time at the door; tap for their faces (confirm, reject,
 * add reference photos) so matching household faces stays easy. */
export function HouseholdSection({ title }: { title: (text: React.ReactNode) => React.ReactNode }) {
  const household = useHouseholdNames();
  const subjects = useAvatars();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {title("Household")}
      <div className="glass rise grid grid-cols-2 gap-2 rounded-[26px] p-3">
        {household.map((n) => {
          const s = subjects[`${HOUSEHOLD}${n}`];
          return (
            <button key={n} onClick={() => setOpen(n)} className="flex items-center gap-2.5 rounded-2xl p-2 text-left active:bg-chip">
              {s?.sample ? (
                <img src={s.sample} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold text-text-dim" style={{ background: "var(--chip-off)" }}>
                  {n.charAt(0)}
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-text">{n}</div>
                <div className="truncate text-xs text-text-dim">
                  {s ? `${s.n} ${s.n === 1 ? "face" : "faces"} · ${day(s.last)}` : "No faces yet"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {open && (
        <Sheet
          title={open}
          subtitle={`Household · ${subjects[`${HOUSEHOLD}${open}`]?.n ?? 0} faces`}
          onClose={() => setOpen(null)}
        >
          <PersonFaces subject={`${HOUSEHOLD}${open}`} name={open} />
        </Sheet>
      )}
    </>
  );
}
