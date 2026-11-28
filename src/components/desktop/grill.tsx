import { AlertTriangle, Fan, Flame, Minus, Plus, Timer } from "lucide-react";
import { GRILL } from "../../config/grill";
import { CookChart, useGrill } from "../home/GrillCard";
import { dur } from "./data";
import { Big, C, Dot, HBar, Label, Panel, Switch } from "./ui";

function Nudge({
  value,
  pending,
  min,
  max,
  step,
  onChange,
  color,
  size = 14,
}: {
  value: number | undefined;
  pending: boolean;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color: string;
  size?: number;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const btn = "rounded border border-dx-line p-1 text-dx-dim hover:text-dx-text disabled:opacity-30";
  return (
    <div className="flex items-center gap-2">
      <button className={btn} aria-label="Lower" disabled={value === undefined || value <= min} onClick={() => value !== undefined && onChange(clamp(value - step))}>
        <Minus size={13} />
      </button>
      <span className="dx-num min-w-[3.2em] text-center" style={{ color, fontSize: size, opacity: pending ? 0.6 : 1 }}>
        {value === undefined ? "—" : `${Math.round(value)}°`}
      </span>
      <button className={btn} aria-label="Raise" disabled={value === undefined || value >= max} onClick={() => value !== undefined && onChange(clamp(value + step))}>
        <Plus size={13} />
      </button>
    </div>
  );
}

/**
 * The Kamado Joe on the desktop console: pit vs. target (adjustable), probes,
 * the cook chart and the auto-hold controls. Same data and actions as the
 * home/phone GrillCard; hidden while the grill is off.
 */
export function GrillPanel({ delay = 0, className }: { delay?: number; className?: string }) {
  const g = useGrill({ pitColor: C.amber, targetColor: C.faint, probeColors: [C.pink, C.violet, C.cyan] });
  if (!g.visible) return null;
  const { now, powerOn, stale, armed, cookStart, pit, target, done, hold, probes, fan, lidOpen, problem, status, series, pitMin, pitMax, holdReady, margin, marginReady, overheat, overBy } = g;
  const stateColor = stale || overheat ? C.red : powerOn ? C.amber : C.faint;

  return (
    <Panel
      title={GRILL.name}
      icon={Flame}
      accent={C.amber}
      delay={delay}
      className={className}
      right={
        <span className="flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: stateColor }}>
          {cookStart && powerOn && (
            <span className="dx-num flex items-center gap-1 text-dx-dim">
              <Timer size={12} /> {dur(now.getTime() - cookStart)}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Dot color={stateColor} pulse={powerOn && !stale} /> {status}
          </span>
        </span>
      }
    >
      {overheat && !stale && (
        <div className="mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-[11.5px] font-semibold" style={{ borderColor: C.red, color: C.red, background: `${C.red}22` }}>
          <Flame size={13} className="shrink-0" />
          Running hot: {Math.round(overBy!)}° over target. Something may be burning.
        </div>
      )}
      {(stale || problem || lidOpen) && (
        <div className="mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-[11.5px] font-semibold" style={{ borderColor: `${C.red}66`, color: C.red, background: `${C.red}12` }}>
          <AlertTriangle size={13} className="shrink-0" />
          {stale ? "No update from the grill for over 5 minutes. It may still be burning." : problem ? "Grill reports an error" : "Lid open"}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Pit + probes */}
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-6">
            <div>
              <Label>Pit</Label>
              <Big value={pit === undefined ? "—" : Math.round(pit)} unit="°F" color={overheat ? C.red : C.amber} size={44} />
              {fan !== undefined && (
                <div className="dx-num mt-1 flex items-center gap-1 text-[11px] text-dx-dim">
                  <Fan size={11} /> fan {Math.round(fan)}%
                </div>
              )}
            </div>
            <div>
              <Label>Target</Label>
              <Nudge value={target.value} pending={target.pending} min={pitMin} max={pitMax} step={5} onChange={target.nudge} color={C.text} size={30} />
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            {probes.length === 0 ? (
              <span className="text-[11.5px] text-dx-dim">No meat probe plugged in.</span>
            ) : (
              probes.map((p) => {
                const goal = done.value ?? p.target;
                return (
                  <HBar
                    key={p.name}
                    label={p.name}
                    value={Math.max(0, p.temp! - 40)}
                    max={goal ? goal - 40 : 1}
                    display={`${Math.round(p.temp!)}°`}
                    sub={goal !== undefined ? `/ ${Math.round(goal)}°` : undefined}
                    color={p.color}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="min-w-0">
          <Label className="mb-2">This cook</Label>
          {cookStart ? (
            <CookChart series={series} start={cookStart} end={now.getTime()} labelClassName="text-dx-dim" gridColor="rgb(127 132 160 / 0.18)" />
          ) : (
            <span className="text-[11.5px] text-dx-dim">Waiting for the cook to start.</span>
          )}
        </div>

        {/* Auto hold */}
        {holdReady && (
          <div className="flex flex-col gap-3 rounded-md border border-dx-line p-3">
            <div className="flex items-center gap-2">
              <Label className="flex-1">Auto hold</Label>
              <Switch
                on={armed}
                color={C.amber}
                label="Auto hold"
                onChange={() => g.callService("input_boolean", armed ? "turn_off" : "turn_on", {}, { entity_id: GRILL.hold.armed }).catch(() => {})}
              />
            </div>
            <div className="text-[11.5px] text-dx-dim">
              {armed ? `When meat hits ${Math.round(done.value ?? 0)}°, drop the pit to ${Math.round(hold.value ?? 0)}°.` : "Off — the pit stays at its target."}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-dx-dim">Meat done at</span>
              <Nudge value={done.value} pending={done.pending} min={100} max={250} step={1} onChange={done.nudge} color={C.text} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-dx-dim">Then hold pit at</span>
              <Nudge value={hold.value} pending={hold.pending} min={150} max={250} step={5} onChange={hold.nudge} color={C.text} />
            </div>
            {marginReady && (
              <div className="flex items-center justify-between gap-2 border-t border-dx-line pt-3">
                <span className="text-[11.5px] text-dx-dim" title="Alarm when the pit runs this far over target for 3 minutes">
                  Overheat alarm at +
                </span>
                <Nudge value={margin.value} pending={margin.pending} min={15} max={150} step={5} onChange={margin.nudge} color={C.red} />
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
