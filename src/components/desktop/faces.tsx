import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ImagePlus, Loader2, ScanFace, Sparkles, Star, StarOff, Wifi, X } from "lucide-react";
import {
  HOUSEHOLD,
  IGNORE,
  assignFaces,
  camLabel,
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
import { saveVisitor, type Session, type VisitLog } from "../../lib/visitors";
import { dur } from "./data";
import { Btn, C, Dot, Label, Panel } from "./ui";

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });



/* --------------------------------------------------------- who-is-this */

const NEW_VISITOR = "__new_visitor";
const NEW_HOUSEHOLD = "__household_other";

/** Picker for who a set of faces belongs to; creates a visitor if asked. */
function WhoPicker({
  log,
  suggestion,
  busy,
  onPick,
}: {
  log: VisitLog;
  suggestion?: string;
  busy?: boolean;
  onPick: (subject: string) => void;
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

  async function apply() {
    if (value === NEW_VISITOR) {
      if (!name.trim()) return;
      const p = await saveVisitor({ name: name.trim(), devices: [], notify: false });
      onPick(p.id);
    } else if (value === NEW_HOUSEHOLD) {
      if (name.trim()) onPick(`${HOUSEHOLD}${name.trim()}`);
    } else if (value) onPick(value);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-md border border-dx-line bg-dx-raise px-2 py-1 text-[11.5px] text-dx-text outline-none focus:border-dx-cyan/60"
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
        <option value={IGNORE}>Not useful / ignore</option>
      </select>
      {naming && (
        <input
          autoFocus
          value={name}
          maxLength={40}
          placeholder="Name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
          className="w-32 rounded-md border border-dx-line bg-dx-raise px-2 py-1 text-[11.5px] text-dx-text outline-none placeholder:text-dx-faint focus:border-dx-cyan/60"
        />
      )}
      <Btn color={C.cyan} disabled={busy || !value || (naming && !name.trim())} onClick={apply}>
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
      </Btn>
    </div>
  );
}

/* ---------------------------------------------------------- review panel */

function ClusterCard({ cluster, log, now, onDone }: { cluster: FaceCluster; log: VisitLog; now: number; onDone: () => void }) {
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hint = useMemo(() => suggestFor(cluster, log, now), [cluster, log, now]);
  const looks = cluster.nearest && cluster.nearest.subject !== hint?.id ? cluster.nearest : null;
  const first = cluster.times[0];
  const last = cluster.times.at(-1)!;
  const days = new Set(cluster.times.map((t) => new Date(t).toDateString())).size;

  async function pick(subject: string) {
    setBusy(true);
    setError(null);
    try {
      await assignFaces(
        cluster.ids.filter((id) => !excluded.has(id)),
        subject,
      );
      avatarsChanged();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dx-line bg-white/[0.015] p-2.5">
      <div className="grid grid-cols-4 gap-1">
        {cluster.faces.map((f) => {
          const out = excluded.has(f.id);
          return (
            <button
              key={f.id}
              onClick={() =>
                setExcluded((s) => {
                  const n = new Set(s);
                  if (n.has(f.id)) n.delete(f.id);
                  else n.add(f.id);
                  return n;
                })
              }
              title={`${camLabel(f.camera)} · ${when(f.t)}${out ? " · left out" : " · click to leave this one out"}`}
              className="relative aspect-square overflow-hidden rounded-[4px] bg-black"
            >
              <img src={f.crop} alt="" className={clsx("h-full w-full object-cover", out && "opacity-25 grayscale")} />
              {out && <X size={16} className="absolute inset-0 m-auto text-dx-red" />}
            </button>
          );
        })}
      </div>
      <div className="dx-num flex flex-wrap items-center gap-x-2 text-[10.5px] text-dx-dim">
        <span className="text-dx-text">{cluster.ids.length}×</span>
        <span>{days} {days === 1 ? "day" : "days"}</span>
        <span className="text-dx-faint">
          {new Date(first).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {days > 1 && ` – ${new Date(last).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
        </span>
        <span className="text-dx-faint">{cluster.cameras.map(camLabel).join(", ")}</span>
      </div>
      {hint && (
        <div className="flex items-center gap-1.5 text-[10.5px] text-dx-green">
          <Dot color={C.green} /> {hint.name}'s phone was on the Wi-Fi for {hint.hits} of {cluster.times.length}
        </div>
      )}
      {looks && (
        <div className="flex items-center gap-1.5 text-[10.5px] text-dx-violet">
          <Sparkles size={11} /> Looks like {subjectName(looks.subject, log)} · {Math.round(looks.score * 100)}%
        </div>
      )}
      <WhoPicker log={log} suggestion={hint?.id ?? looks?.subject} busy={busy} onPick={pick} />
      {error && <div className="text-[10.5px] text-dx-red">{error}</div>}
    </div>
  );
}

/** Unknown faces grouped by likeness, to name in bulk. */
export function FaceReview({ log, onChanged }: { log: VisitLog; onChanged: () => void }) {
  const now = useNow(60_000).getTime();
  const [clusters, setClusters] = useState<FaceCluster[] | null>(null);
  const [status, setStatus] = useState<FaceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(24);

  const load = useCallback(() => {
    faceStatus().then(setStatus).catch((e: Error) => setError(e.message));
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

  const q = status?.queue ?? {};
  const pending = q.pending ?? 0;
  const done = q.done ?? 0;
  const total = pending + done + (q.failed ?? 0);
  const unknown = status?.faces.unknown ?? 0;
  const shown = (clusters ?? []).filter((c) => c.ids.length > 0);

  return (
    <Panel
      title="Faces · review"
      icon={ScanFace}
      accent={C.violet}
      delay={140}
      right={
        status && (
          <span className="dx-num flex items-center gap-3 text-[10.5px] text-dx-dim">
            {pending > 0 && (
              <span className="flex items-center gap-1.5 text-dx-amber">
                <Loader2 size={11} className="animate-spin" /> scanning {done}/{total} frames
              </span>
            )}
            <span>
              {status.faces.n ?? 0} faces · {unknown} unnamed · {status.faces.confirmed ?? 0} confirmed · {status.faces.auto ?? 0} matched
            </span>
            {!status.model.startsWith("ready") && <span className="text-dx-amber">model {status.model}</span>}
          </span>
        )
      }
    >
      {error && !clusters ? (
        <div className="text-[12px] text-dx-red">Couldn't reach the face service: {error}</div>
      ) : !clusters ? (
        <div className="h-32 animate-pulse rounded bg-white/[0.03]" />
      ) : shown.length === 0 ? (
        <div className="py-4 text-[12px] text-dx-dim">
          {pending > 0 ? "Scanning past doorbell and driveway detections; faces show up here as they're found." : "Every face found so far has a name."}
        </div>
      ) : (
        <>
          <p className="mb-3 text-[11px] text-dx-faint">
            Faces from person detections at the front door and driveway, grouped by likeness. Name a group once and future sightings are matched
            automatically. Click a face to leave it out of the group.
          </p>
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
            {shown.map((c) => (
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
          </div>
          {clusters.length >= limit && (
            <div className="mt-3 text-center">
              <Btn onClick={() => setLimit((l) => l + 24)}>Show more groups</Btn>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------ visitor gallery */

/** Unnamed faces from while this visitor's phone was on the Wi-Fi, most
 * like them first: select, then confirm or reject. */
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
    setPicked(new Set());
    setBusy(false);
    avatarsChanged();
    load();
    onChanged();
  }

  return (
    <div className="mt-3 rounded-md border border-dashed border-dx-green/40 bg-dx-green/[0.03] p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Wifi size={12} className="text-dx-green" />
        <Label className="flex-1 text-dx-green">
          Seen while {first}'s phone was here · {list.length}
          {list.some((f) => f.sim !== null) && <span className="ml-1.5 normal-case tracking-normal text-dx-faint">most alike first</span>}
        </Label>
        <button
          onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((f) => f.id)))}
          className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-dx-dim hover:text-dx-text"
        >
          {picked.size === list.length ? "Clear" : "Select all"}
        </button>
        <Btn color={C.green} disabled={busy || picked.size === 0} onClick={() => answer(true)}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} It's {first}
          {picked.size > 0 && ` (${picked.size})`}
        </Btn>
        <Btn disabled={busy || picked.size === 0} onClick={() => answer(false)}>
          <X size={11} /> Not {first}
        </Btn>
      </div>
      <div className="dx-scroll grid max-h-[200px] grid-cols-10 gap-1 overflow-y-auto pr-1">
        {list.map((f) => {
          const on = picked.has(f.id);
          return (
            <button
              key={f.id}
              onClick={() =>
                setPicked((s) => {
                  const n = new Set(s);
                  if (n.has(f.id)) n.delete(f.id);
                  else n.add(f.id);
                  return n;
                })
              }
              title={`${camLabel(f.camera)} · ${when(f.t)}${f.sim !== null ? ` · ${Math.round(f.sim * 100)}% like ${first}` : ""}`}
              className="relative aspect-square overflow-hidden rounded-[4px] border bg-black"
              style={{ borderColor: on ? C.green : "rgba(255,255,255,0.08)", boxShadow: on ? `0 0 8px ${C.green}` : undefined }}
            >
              <img src={f.crop} alt="" className={clsx("h-full w-full object-cover", !on && picked.size > 0 && "opacity-60")} />
              {f.sim !== null && (
                <span className="dx-num absolute bottom-0 right-0 bg-black/70 px-0.5 text-[9px] text-dx-text">{Math.round(f.sim * 100)}</span>
              )}
              {on && <Check size={12} className="absolute left-0.5 top-0.5 rounded-full bg-dx-green p-px text-black" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A person's faces: confirmed ones solid, auto-matched ones dashed with
 * confirm / reject, plus reference photo upload. */
export function SubjectFaces({ subject, name, color, visits = [] }: { subject: string; name: string; color: string; visits?: Session[] }) {
  const avatar = useAvatars()[subject];
  const now = useNow(60_000).getTime();
  const [faces, setFaces] = useState<Face[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    facesOf(subject, 48)
      .then(setFaces)
      .catch(() => setFaces([]));
  }, [subject]);
  useEffect(() => {
    setFaces(null);
    setMessage(null);
    load();
  }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);
    setMessage(await uploadPhotos(subject, files));
    setBusy(false);
    load();
  }

  async function set(id: number, to: string | null) {
    await assignFaces([id], to).catch(() => {});
    avatarsChanged();
    load();
  }

  async function profile(id: number | null) {
    await setAvatar(subject, id).catch(() => {});
    avatarsChanged();
  }

  const seen = faces?.filter((f) => f.camera !== "upload") ?? [];
  const lastSeen = seen[0];

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <Label className="flex-1">
          Faces{faces ? ` · ${faces.length}${faces.length >= 48 ? "+" : ""}` : ""}
          {lastSeen && (
            <span className="ml-2 normal-case tracking-normal text-dx-faint">
              last at the {camLabel(lastSeen.camera).toLowerCase()} {dur(now - lastSeen.t)} ago
            </span>
          )}
        </Label>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files).finally(() => (e.target.value = ""))} />
        <Btn onClick={() => file.current?.click()} disabled={busy} title={`Upload clear photos of ${name}'s face`}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />} Add photos
        </Btn>
      </div>
      {!faces ? (
        <div className="h-16 animate-pulse rounded bg-white/[0.03]" />
      ) : faces.length === 0 ? (
        <div className="rounded-md border border-dashed border-dx-line px-3 py-3 text-[11.5px] text-dx-dim">
          No faces yet. Name a group under Faces · review, or add a few clear photos.
        </div>
      ) : (
        <div className="dx-scroll grid max-h-[220px] grid-cols-8 gap-1 overflow-y-auto pr-1">
          {faces.map((f) => (
            <div
              key={f.id}
              title={`${camLabel(f.camera)} · ${when(f.t)}${f.label === "auto" ? ` · matched ${Math.round(f.score * 100)}%` : ""}`}
              className={clsx("group relative aspect-square overflow-hidden rounded-[4px] border bg-black", f.label === "auto" ? "border-dashed" : "border-solid")}
              style={{ borderColor: f.label === "auto" ? `${color}88` : color }}
            >
              <img src={f.crop} alt="" className="h-full w-full object-cover" />
              {avatar?.avatar_id === f.id && (
                <span
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5"
                  title={avatar.avatar_chosen ? "Profile picture" : "Profile picture (latest face, until you pick one)"}
                >
                  <Star size={10} className="fill-dx-amber text-dx-amber" />
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 hidden justify-center gap-1.5 bg-black/75 py-0.5 group-hover:flex">
                {f.label === "auto" && (
                  <>
                    <button onClick={() => set(f.id, subject)} title="Yes, that's them" className="text-dx-green">
                      <Check size={13} />
                    </button>
                    <button onClick={() => set(f.id, null)} title="Not them" className="text-dx-red">
                      <X size={13} />
                    </button>
                  </>
                )}
                {avatar?.avatar_id === f.id && avatar.avatar_chosen ? (
                  <button onClick={() => profile(null)} title="Go back to their latest face" className="text-dx-amber">
                    <StarOff size={13} />
                  </button>
                ) : (
                  avatar?.avatar_id !== f.id && (
                    <button onClick={() => profile(f.id)} title="Use as profile picture" className="text-dx-amber">
                      <Star size={13} />
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {message && <div className="mt-1.5 text-[10.5px] text-dx-dim">{message}</div>}
      {visits.length > 0 && <VisitSuggestions subject={subject} name={name} visits={visits} onChanged={load} />}
    </div>
  );
}

export { useFaceNames } from "../../lib/useFaceNames";
