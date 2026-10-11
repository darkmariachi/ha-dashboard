import { useEffect, useState } from "react";
import { useHa } from "../../ha/HaProvider";

export interface StatePoint {
  state: string;
  /** Epoch ms the state took effect. */
  t: number;
  /** Only filled in when fetched with `withAttributes`. */
  attributes?: Record<string, unknown>;
}

/** HA's compressed history format: s = state, a = attributes, lc/lu = last
 * changed / updated in epoch seconds (lc is omitted when it equals lu). */
type Compressed = { s: string; a?: Record<string, unknown>; lc?: number; lu: number };

/**
 * Raw state changes for some entities over the last `hours`, fetched when
 * the caller mounts and again every `refreshMs` if given — for logs and
 * timelines, where useEntityHistory's averaged buckets would lose the
 * actual events. `withAttributes` keeps each point's attributes (costs a
 * bigger response; needed for e.g. event entities' event_type).
 */
export function useStateHistory(
  entityIds: string[],
  hours: number,
  { withAttributes = false, refreshMs }: { withAttributes?: boolean; refreshMs?: number } = {},
) {
  const { sendMessage } = useHa();
  const [history, setHistory] = useState<Record<string, StatePoint[]> | null>(null);
  const key = entityIds.join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    function load() {
      sendMessage<Record<string, Compressed[]>>({
        type: "history/history_during_period",
        start_time: new Date(Date.now() - hours * 3600 * 1000).toISOString(),
        entity_ids: key.split(","),
        minimal_response: !withAttributes,
        no_attributes: !withAttributes,
        significant_changes_only: false,
      })
        .then((res) => {
          if (cancelled) return;
          const out: Record<string, StatePoint[]> = {};
          for (const [id, points] of Object.entries(res)) {
            out[id] = points.map((p) => ({
              state: p.s,
              t: (p.lc ?? p.lu) * 1000,
              ...(withAttributes && p.a ? { attributes: p.a } : {}),
            }));
          }
          setHistory(out);
        })
        .catch(() => {
          if (!cancelled) setHistory((h) => h ?? {});
        });
    }
    load();
    const timer = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [key, hours, withAttributes, refreshMs, sendMessage]);

  return history;
}
