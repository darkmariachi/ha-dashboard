import { useCallback, useEffect, useState } from "react";
import { HOUSEHOLD_PEOPLE } from "../config/curatedHome";
import { useHa } from "../ha/HaProvider";
import { faceSightings, faceSubjects, subjectName, type FaceSubject, type Sighting } from "./faces";
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

/** First names of the household's HA people, for the who-is-this pickers. */
export function useHouseholdNames() {
  const { entities } = useHa();
  return HOUSEHOLD_PEOPLE.map((id) => ((entities[id]?.attributes.friendly_name as string | undefined) ?? id.split(".")[1]).split(" ")[0]);
}

const AVATARS_CHANGED = "faces:avatars-changed";

/** Tell every useAvatars on the page to reload (after choosing a picture or
 * naming faces). */
export function avatarsChanged() {
  window.dispatchEvent(new Event(AVATARS_CHANGED));
}

/** Profile pictures by subject (visitor id / household:Name), from the face
 * service; refreshed every few minutes and whenever avatarsChanged() fires. */
export function useAvatars() {
  const [subjects, setSubjects] = useState<Record<string, FaceSubject>>({});
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      faceSubjects()
        .then((list) => !cancelled && setSubjects(Object.fromEntries(list.map((s) => [s.subject, s]))))
        .catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    window.addEventListener(AVATARS_CHANGED, load);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener(AVATARS_CHANGED, load);
    };
  }, []);
  return subjects;
}
