import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CURATED_QUICK_ACTIONS } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { ON_STATES } from "../../lib/entityHelpers";
import { Sheet } from "../home/Sheet";

/**
 * Opens a confirm sheet for a quick action named in the URL
 * (/phone?run=leaving), which is where push notifications link to — web
 * push can't carry action buttons on iPhone, so the notification opens the
 * app here instead. Lists what's on, then runs the action on one tap.
 */
export function QuickActionLink() {
  const { entities, callService } = useHa();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const action = CURATED_QUICK_ACTIONS.find((a) => a.key === params.get("run"));
  if (!action) return null;

  const close = () => navigate({ search: "" }, { replace: true });
  const on = action.entityIds
    .filter((id) => ON_STATES.has(entities[id]?.state ?? ""))
    .map((id) => (entities[id]?.attributes.friendly_name as string | undefined) ?? id);
  const turningOn = action.action === "turn_on";

  function run() {
    setBusy(true);
    navigator.vibrate?.(15);
    callService("homeassistant", action!.action, {}, { entity_id: action!.entityIds })
      .catch(() => {})
      .finally(close);
  }

  return (
    <Sheet title={action.label} subtitle={action.description} onClose={close}>
      {!turningOn && (
        <div className="rounded-2xl bg-chip px-4 py-3 text-sm text-text">
          {on.length === 0 ? (
            "Everything's already off."
          ) : (
            <>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">On right now</div>
              <ul className="flex flex-col gap-1">
                {on.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <button
        onClick={run}
        disabled={busy || (!turningOn && on.length === 0)}
        className="flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
        style={{ background: "#4f79c9" }}
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        {turningOn ? "Turn them on" : on.length > 0 ? `Turn off ${on.length === 1 ? "it" : `all ${on.length}`}` : "Nothing to turn off"}
      </button>
    </Sheet>
  );
}
