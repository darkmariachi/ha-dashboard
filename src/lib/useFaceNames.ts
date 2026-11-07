import { useCallback, useEffect, useState } from "react";
import { HOUSEHOLD_PEOPLE } from "../config/curatedHome";
import { useHa } from "../ha/HaProvider";
import { faceSeen, faceSightings, faceSubjects, householdName, subjectName, type FaceSubject, type Sighting } from "./faces";
import { fetchVisitLog, type VisitLog } from "./visitors";

/**
 * Who the face service recognised at a camera around a time, for labelling
 * person / ring detections in activity feeds ("Sandra · Front door").
 * Refreshes every minute; returns null where nobody was recognised (or
 * the face service isn't reachable).
 */
export function useFaceNames(hours: number) {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [log, setLog] = useState<VisitLog | null>(null);
  useEffect(() => {
    let cancelled = false;
    function load() {
      faceSightings(Date.now() - hours * 3600_000)
        .then((s) => !cancelled && setSightings(s))
        .catch(() => {});
      fetchVisitLog()
        .then((l) => !cancelled && setLog(l))
        .catch(() => {});
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [hours]);

  return useCallback(
    (camera: string, t: number) => {
      const names = new Set<string>();
      for (const s of sightings) {
        if (s.camera === camera && Math.abs(s.t - t) <= 4000) {
          const n = subjectName(s.subject, log);
          if (n) names.add(n);
        }
      }
      return names.size ? [...names].join(", ") : null;
    },
    [sightings, log],
  );
}

/* ------------------------------------------- shared subject list (store) */

// One /subjects fetch shared by every component on the page (pickers on
// each face card, avatars in lists), refreshed every few minutes and when
// avatarsChanged() fires.
type Subjects = Record<string, FaceSubject>;
type Seen = Record<string, number[]>;
let subjectsCache: Subjects = {};
let seenCache: Seen = {};
const listeners = new Set<(s: Subjects) => void>();
const seenListeners = new Set<(s: Seen) => void>();
let inflight: Promise<void> | null = null;
let loadedAt = 0;

function loadSubjects(force = false) {
  if (inflight || (!force && Date.now() - loadedAt < 5 * 60_000)) return;
  inflight = Promise.all([faceSubjects(), faceSeen().catch(() => seenCache)])
    .then(([list, seen]) => {
      subjectsCache = Object.fromEntries(list.map((s) => [s.subject, s]));
      seenCache = seen;
      loadedAt = Date.now();
      listeners.forEach((l) => l(subjectsCache));
      seenListeners.forEach((l) => l(seenCache));
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
}

/** Tell every useAvatars on the page to reload (after choosing a picture or
 * naming faces). */
export function avatarsChanged() {
  loadSubjects(true);
}

/** Profile pictures and counts by subject (visitor id / household:Name). */
export function useAvatars(): Subjects {
  const [subjects, setSubjects] = useState<Subjects>(subjectsCache);
  useEffect(() => {
    listeners.add(setSubjects);
    loadSubjects();
    const t = setInterval(() => loadSubjects(), 5 * 60_000);
    return () => {
      listeners.delete(setSubjects);
      clearInterval(t);
    };
  }, []);
  return subjects;
}

/** When each named person was seen on camera (for camera-based visits);
 * shares the avatars' fetch and refresh. */
export function useFaceSeen(): Seen {
  const [seen, setSeen] = useState<Seen>(seenCache);
  useEffect(() => {
    seenListeners.add(setSeen);
    loadSubjects();
    return () => {
      seenListeners.delete(setSeen);
    };
  }, []);
  return seen;
}

/** Household names for the who-is-this pickers: the HA people's first
 * names, plus anyone already named as household in the face service
 * (added with "Someone else in the household…"). */
export function useHouseholdNames() {
  const { entities } = useHa();
  const subjects = useAvatars();
  const names = HOUSEHOLD_PEOPLE.map((id) => ((entities[id]?.attributes.friendly_name as string | undefined) ?? id.split(".")[1]).split(" ")[0]);
  for (const key of Object.keys(subjects)) {
    const n = householdName(key);
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
}
