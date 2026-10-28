import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AWAY_COOL_TEMP, CURATED_CLIMATE_ENTITY } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { Sheet } from "../home/Sheet";

/**
 * Confirm sheet behind the "nobody's home" thermostat reminder
 * (/phone?run=away_temp), like QuickActionLink: shows what the AC is set to
 * and raises it to AWAY_COOL_TEMP on one tap. In heat/cool mode only the
 * cooling side moves.
 */
export function ThermostatAwayLink() {
  const { entities, callService } = useHa();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (params.get("run") !== "away_temp") return null;

  const close = () => navigate({ search: "" }, { replace: true });
  const climate = entities[CURATED_CLIMATE_ENTITY];
  const mode = climate?.state ?? "";
  const isRange = mode === "heat_cool";
  const low = climate?.attributes.target_temp_low as number | undefined;
  const target = (isRange ? climate?.attributes.target_temp_high : climate?.attributes.temperature) as number | undefined;
  const already = typeof target === "number" && target >= AWAY_COOL_TEMP;
  const canSet = (mode === "cool" || (isRange && typeof low === "number" && low < AWAY_COOL_TEMP)) && !already;

  function run() {
    setBusy(true);
    navigator.vibrate?.(15);
    const data = isRange ? { target_temp_low: low, target_temp_high: AWAY_COOL_TEMP } : { temperature: AWAY_COOL_TEMP };
    callService("climate", "set_temperature", data, { entity_id: CURATED_CLIMATE_ENTITY })
      .catch(() => {})
      .finally(close);
  }

  return (
    <Sheet title="Thermostat" subtitle={`Nobody's home — set the AC to ${AWAY_COOL_TEMP}°.`} onClose={close}>
      <div className="rounded-2xl bg-chip px-4 py-3 text-sm text-text">
        {!climate
          ? "The thermostat isn't reporting right now."
          : mode === "off"
            ? "The AC is off."
            : typeof target === "number"
              ? `Set to ${target}° (${mode.replace("_", "/")}), ${climate.attributes.current_temperature ?? "?"}° inside.`
              : `Mode: ${mode}.`}
      </div>
      <button
        onClick={run}
        disabled={busy || !canSet}
        className="flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
        style={{ background: "#4f79c9" }}
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        {already ? `Already at ${target}°` : canSet ? `Set to ${AWAY_COOL_TEMP}°` : "Nothing to change"}
      </button>
    </Sheet>
  );
}
