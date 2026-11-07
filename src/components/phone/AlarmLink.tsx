import { Loader2, Shield, ShieldOff } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DESKTOP_ALARM } from "../../config/desktop";
import { useHa } from "../../ha/HaProvider";
import { Sheet } from "../home/Sheet";

/**
 * Confirm sheets behind the alarm reminders HA pushes, like
 * ThermostatAwayLink: /phone?run=arm_alarm ("nobody's home — arm it?") and
 * /phone?run=disarm_alarm ("you're home and it's still armed"). UniFi
 * Protect's alarm manager only has Away and needs no code.
 */
export function AlarmLink() {
  const { entities, callService } = useHa();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = params.get("run");
  if (run !== "arm_alarm" && run !== "disarm_alarm") return null;

  const arming = run === "arm_alarm";
  const close = () => navigate({ search: "" }, { replace: true });
  const alarm = entities[DESKTOP_ALARM];
  const state = alarm?.state ?? "unavailable";
  const armed = state.startsWith("armed") || state === "arming" || state === "triggered";
  const nothingToDo = arming ? armed : !armed;

  function go() {
    setBusy(true);
    navigator.vibrate?.(15);
    callService("alarm_control_panel", arming ? "alarm_arm_away" : "alarm_disarm", {}, { entity_id: DESKTOP_ALARM })
      .catch(() => {})
      .finally(close);
  }

  return (
    <Sheet
      title="Alarm"
      subtitle={arming ? "Nobody's home — arm the alarm?" : "You're home and the alarm is armed."}
      onClose={close}
    >
      <div className="rounded-2xl bg-chip px-4 py-3 text-sm capitalize text-text">
        {alarm ? `Right now: ${state.replace(/_/g, " ")}` : "The alarm isn't reporting right now."}
      </div>
      <button
        onClick={go}
        disabled={busy || !alarm || nothingToDo}
        className="flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white active:scale-95 disabled:opacity-50"
        style={{ background: arming ? "#d14d5b" : "#2fae7e" }}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : arming ? <Shield size={16} /> : <ShieldOff size={16} />}
        {nothingToDo ? (arming ? "Already armed" : "Already disarmed") : arming ? "Arm (away)" : "Disarm"}
      </button>
    </Sheet>
  );
}
