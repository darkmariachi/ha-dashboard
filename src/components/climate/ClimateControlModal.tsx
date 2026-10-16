import { Droplets, Fan, Flame, Minus, Plus, Power, Snowflake, Thermometer, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useHa } from "../../ha/HaProvider";
import { clsx } from "clsx";
import { RadialDial } from "./RadialDial";

const MODE_META: Record<string, { icon: LucideIcon; label: string }> = {
  off: { icon: Power, label: "Off" },
  heat: { icon: Flame, label: "Heat" },
  cool: { icon: Snowflake, label: "Cool" },
  heat_cool: { icon: Thermometer, label: "Heat/Cool" },
  auto: { icon: Thermometer, label: "Auto" },
  fan_only: { icon: Fan, label: "Fan" },
  dry: { icon: Droplets, label: "Dry" },
};

type TempKey = "temperature" | "target_temp_low" | "target_temp_high";

function modeMeta(mode: string) {
  return MODE_META[mode] ?? { icon: Thermometer, label: mode };
}

export function ClimateControlModal({
  entityId,
  onClose,
}: {
  entityId: string;
  onClose: () => void;
}) {
  const { entities, callService } = useHa();
  const entity = entities[entityId];
  // Values picked with the +/- buttons but not yet reported back by HA, so
  // rapid taps stack up and go out as a single set_temperature call.
  const [draft, setDraft] = useState<Partial<Record<TempKey, number>>>({});
  const sendTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const haTarget = entity?.attributes.temperature as number | undefined;
  const haLow = entity?.attributes.target_temp_low as number | undefined;
  const haHigh = entity?.attributes.target_temp_high as number | undefined;
  useEffect(() => setDraft({}), [haTarget, haLow, haHigh]);

  if (!entity) return null;

  const attrs = entity.attributes;
  const mode = entity.state; // off | heat | cool | heat_cool | auto | fan_only | dry
  const current = attrs.current_temperature as number | undefined;
  const target = draft.temperature ?? haTarget;
  const targetLow = draft.target_temp_low ?? haLow;
  const targetHigh = draft.target_temp_high ?? haHigh;
  const hvacAction = attrs.hvac_action as string | undefined;
  const step = (attrs.target_temp_step as number | undefined) ?? 1;
  const minTemp = (attrs.min_temp as number | undefined) ?? 50;
  const maxTemp = (attrs.max_temp as number | undefined) ?? 95;
  const hvacModes = (attrs.hvac_modes as string[] | undefined) ?? [mode];
  const fanModes = attrs.fan_modes as string[] | undefined;
  const fanMode = attrs.fan_mode as string | undefined;
  const isRange = typeof targetLow === "number" && typeof targetHigh === "number";
  const off = mode === "off";

  function setMode(next: string) {
    callService("climate", "set_hvac_mode", { hvac_mode: next }, { entity_id: entityId }).catch(
      () => {},
    );
  }

  function setFan(next: string) {
    callService("climate", "set_fan_mode", { fan_mode: next }, { entity_id: entityId }).catch(
      () => {},
    );
  }

  function setSingleTarget(value: number) {
    callService(
      "climate",
      "set_temperature",
      { temperature: value },
      { entity_id: entityId },
    ).catch(() => {});
  }

  function setRangeTarget(which: "low" | "high", value: number) {
    if (typeof targetLow !== "number" || typeof targetHigh !== "number") return;
    const nextLow = which === "low" ? value : targetLow;
    const nextHigh = which === "high" ? value : targetHigh;
    if (nextLow >= nextHigh) return;
    callService(
      "climate",
      "set_temperature",
      { target_temp_low: nextLow, target_temp_high: nextHigh },
      { entity_id: entityId },
    ).catch(() => {});
  }

  function nudge(key: TempKey, delta: number) {
    const base = key === "temperature" ? target : key === "target_temp_low" ? targetLow : targetHigh;
    if (typeof base !== "number") return;
    let next = Math.min(maxTemp, Math.max(minTemp, Math.round((base + delta) / step) * step));
    if (key === "target_temp_low" && typeof targetHigh === "number") next = Math.min(next, targetHigh - step);
    if (key === "target_temp_high" && typeof targetLow === "number") next = Math.max(next, targetLow + step);
    if (next === base) return;
    const nextDraft = { ...draft, [key]: next };
    setDraft(nextDraft);
    clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      const data = isRange
        ? {
            target_temp_low: nextDraft.target_temp_low ?? targetLow,
            target_temp_high: nextDraft.target_temp_high ?? targetHigh,
          }
        : { temperature: nextDraft.temperature };
      callService("climate", "set_temperature", data, { entity_id: entityId }).catch(() =>
        setDraft({}),
      );
    }, 600);
  }

  function dialColorFor(m: string) {
    if (m === "cool") return "var(--color-accent)";
    if (m === "heat") return "var(--color-warn)";
    if (m === "heat_cool" || m === "auto") return "var(--color-ok)";
    return "var(--color-text-dim)";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />

      <div
        className="relative flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold text-text">{entity.attributes.friendly_name ?? entityId}</div>
            <div className="text-xs text-text-dim">
              {current !== undefined ? `Currently ${current}°` : "—"}
              {hvacAction && !off ? ` · ${hvacAction}` : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-dim hover:bg-chip hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        {/* Target temperature */}
        {off ? (
          <div className="rounded-xl bg-chip px-4 py-6 text-center text-sm text-text-dim">
            Turn on heat or cool to set a target
          </div>
        ) : isRange ? (
          <div className="flex flex-col items-center gap-3 py-1">
            <RadialDial
              min={minTemp}
              max={maxTemp}
              step={step}
              centerLabel={hvacAction}
              handles={[
                {
                  value: targetLow!,
                  color: "var(--color-accent)",
                  onCommit: (v) => setRangeTarget("low", v),
                },
                {
                  value: targetHigh!,
                  color: "var(--color-warn)",
                  onCommit: (v) => setRangeTarget("high", v),
                },
              ]}
            />
            <div className="flex w-full justify-around">
              <Stepper
                label="Low"
                color="var(--color-accent)"
                onDown={() => nudge("target_temp_low", -step)}
                onUp={() => nudge("target_temp_low", step)}
              />
              <Stepper
                label="High"
                color="var(--color-warn)"
                onDown={() => nudge("target_temp_high", -step)}
                onUp={() => nudge("target_temp_high", step)}
              />
            </div>
          </div>
        ) : typeof target === "number" ? (
          <div className="flex flex-col items-center gap-3 py-1">
            <RadialDial
              min={minTemp}
              max={maxTemp}
              step={step}
              centerLabel={hvacAction}
              handles={[
                {
                  value: target,
                  color: dialColorFor(mode),
                  onCommit: setSingleTarget,
                },
              ]}
            />
            <Stepper
              onDown={() => nudge("temperature", -step)}
              onUp={() => nudge("temperature", step)}
            />
          </div>
        ) : null}

        {/* HVAC mode */}
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-dim">
            Mode
          </div>
          <div className="flex flex-wrap gap-2">
            {hvacModes.map((m) => {
              const { icon: Icon, label } = modeMeta(m);
              const isActive = m === mode;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-accent text-white"
                      : "bg-chip text-text-dim hover:bg-chip-hover hover:text-text",
                  )}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fan mode */}
        {fanModes && fanModes.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-dim">
              Fan
            </div>
            <div className="flex flex-wrap gap-2">
              {fanModes.map((f) => (
                <button
                  key={f}
                  onClick={() => setFan(f)}
                  className={clsx(
                    "rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    f === fanMode
                      ? "bg-accent text-white"
                      : "bg-chip text-text-dim hover:bg-chip-hover hover:text-text",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stepper({
  label,
  color,
  onDown,
  onUp,
}: {
  label?: string;
  color?: string;
  onDown: () => void;
  onUp: () => void;
}) {
  const btn =
    "flex h-11 w-11 items-center justify-center rounded-full bg-chip text-text transition-colors hover:bg-chip-hover active:scale-95";
  return (
    <div className="flex items-center gap-3">
      <button onClick={onDown} aria-label={`Lower ${label ?? "target"} temperature`} className={btn}>
        <Minus size={18} />
      </button>
      {label && (
        <span className="w-9 text-center text-[11px] font-medium uppercase tracking-wide" style={{ color }}>
          {label}
        </span>
      )}
      <button onClick={onUp} aria-label={`Raise ${label ?? "target"} temperature`} className={btn}>
        <Plus size={18} />
      </button>
    </div>
  );
}
