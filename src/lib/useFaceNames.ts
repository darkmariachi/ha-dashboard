import { useCallback, useEffect, useState } from "react";
import { HOUSEHOLD_PEOPLE } from "../config/curatedHome";
import { useHa } from "../ha/HaProvider";
import { faceSightings, subjectName, type Sighting } from "./faces";
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
