import { useEffect, useState } from "react";
import type { HassEntities } from "home-assistant-js-websocket";
import { CURATED_ENERGY } from "../config/curatedHome";
import { useHa } from "../ha/HaProvider";

/** The Sense monitor's own sensors share this prefix. */
const SENSE = CURATED_ENERGY.consumption.replace(/_energy$/, "");

interface EnergyPrefs {
  energy_sources?: { type: string; number_energy_price?: number | null; entity_energy_price?: string | null }[];
}

/**
 * The grid price per kWh from Home Assistant's own energy settings
 * (Settings → Dashboards → Energy), so it's set in one place: a fixed price,
 * or the current state of a price entity. null until loaded / if unset.
 */
export function useEnergyPrice(): number | null {
  const { status, sendMessage, entities } = useHa();
  const [prefs, setPrefs] = useState<EnergyPrefs | null>(null);
  useEffect(() => {
    if (status !== "connected") return;
    sendMessage<EnergyPrefs>({ type: "energy/get_prefs" })
      .then(setPrefs)
      .catch(() => {});
  }, [status, sendMessage]);
  const grid = prefs?.energy_sources?.find((s) => s.type === "grid");
  if (grid?.number_energy_price != null) return grid.number_energy_price;
  const fromEntity = grid?.entity_energy_price ? parseFloat(entities[grid.entity_energy_price]?.state ?? "") : NaN;
  return Number.isFinite(fromEntity) ? fromEntity : null;
}

function kwh(entities: HassEntities, key: string) {
  const v = parseFloat(entities[`${SENSE}_${key}`]?.state ?? "");
  return Number.isFinite(v) ? v : null;
}

export interface EnergyCost {
  today: number | null;
  month: number | null;
  /** Month-to-date cost scaled to the whole month. */
  projected: number | null;
  /** What the solar made this month would have cost from the grid. */
  solarSaved: number | null;
}

/** Grid cost today / this month / projected, and solar savings, at `price`. */
export function energyCost(entities: HassEntities, price: number | null, now = new Date()): EnergyCost {
  if (price === null) return { today: null, month: null, projected: null, solarSaved: null };
  const today = kwh(entities, "daily_from_grid");
  const month = kwh(entities, "monthly_from_grid");
  const made = kwh(entities, "monthly_production");
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = now.getDate() - 1 + (now.getHours() * 60 + now.getMinutes()) / 1440;
  return {
    today: today === null ? null : today * price,
    month: month === null ? null : month * price,
    projected: month === null || elapsed < 0.5 ? null : (month / elapsed) * daysIn * price,
    solarSaved: made === null ? null : made * price,
  };
}

export const money = (v: number | null) => (v === null ? "—" : `$${v.toFixed(v >= 100 ? 0 : 2)}`);
