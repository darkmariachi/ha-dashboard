import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  Bot,
  Droplets,
  Fan,
  LayoutGrid,
  Minus,
  Pause,
  Play,
  Plus,
  Power,
  SlidersHorizontal,
  Sprout,
  Thermometer,
  Tv,
  Volume1,
  Volume2,
} from "lucide-react";
import {
  CURATED_CLIMATE_ENTITY,
  CURATED_ROOMS,
  CURATED_SPRINKLERS,
  CURATED_TVS,
  CURATED_VACUUM,
  TV_APPS,
  type CuratedRoom,
} from "../../config/curatedHome";
import { DESKTOP_INDOOR } from "../../config/desktop";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { LightSheet } from "../home/LightSheet";
import { useOnNow } from "../home/OnNowModal";
import { useEntityHistory } from "../home/useEntityHistory";
import { LineChart } from "./charts";
import { dur, num } from "./data";
import { Big, Btn, C, Dot, KV, Label, Panel, Ring, Segmented, Switch } from "./ui";

const ROOM_NEON = () => [C.cyan, C.pink, C.violet, C.green, C.amber, C.pink, C.green, C.cyan];

function useToggle() {
  const { callService } = useHa();
  return (entityId: string) => callService(entityId.split(".")[0], "toggle", {}, { entity_id: entityId }).catch(() => {});
}

/** Brightness slider that only calls HA on release. */
function Dimmer({ entityId, color }: { entityId: string; color: string }) {
  const { entities, callService } = useHa();
  const e = entities[entityId];
  const on = e?.state === "on";
  const value = on ? Math.round(((e?.attributes.brightness as number | undefined) ?? 0) / 2.55) : 0;
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  function commit() {
    if (drag === null) return;
    callService("light", drag <= 0 ? "turn_off" : "turn_on", drag <= 0 ? {} : { brightness_pct: drag }, { entity_id: entityId }).catch(() => {});
    setDrag(null);
  }
  return (
    <div className="flex flex-1 items-center gap-2">
      <input
        type="range"
        min={0}
        max={100}
        value={shown}
        aria-label="Brightness"
        className="dx-range flex-1"
        style={{ "--fill": `${shown}%` } as React.CSSProperties}
        onChange={(ev) => setDrag(Number(ev.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <span className="dx-num w-9 text-right text-[11px]" style={{ color: shown ? color : C.faint }}>
        {shown ? `${shown}%` : "off"}
      </span>
    </div>
  );
}

/** One toggle as a flat cell: icon + label, lit in the room's color. */
function Cell({ entityId, label, icon: Icon, color }: { entityId: string; label: string; icon: typeof Fan; color: string }) {
  const { entities } = useHa();
  const toggle = useToggle();
  const state = entities[entityId]?.state;
  const dead = state === undefined || state === "unavailable";
  const on = state === "on";
  return (
    <button
      onClick={() => !dead && toggle(entityId)}
      disabled={dead}
      title={dead ? `${label} · unavailable` : `${label} · ${on ? "on" : "off"}`}
      className={clsx(
        "flex min-w-0 items-center gap-1.5 rounded-[5px] border px-2 py-[5px] text-[11px] font-medium transition-all disabled:opacity-30",
        !on && "border-dx-line text-dx-dim hover:border-white/20 hover:text-dx-text",
      )}
      style={on ? { borderColor: `${color}aa`, color, background: `${color}14`, boxShadow: `0 0 12px -4px ${color}` } : undefined}
    >
      <Icon size={12} className={clsx("shrink-0", on && Icon === Fan && "animate-spin [animation-duration:2s]")} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Every room as one dense row: name, its switches, its Hue dimmer. */
export function RoomsMatrix({ delay = 0, className }: { delay?: number; className?: string }) {
  const { entities } = useHa();
  const [sheet, setSheet] = useState<{ room: CuratedRoom; color: string } | null>(null);
  const total = CURATED_ROOMS.reduce((n, r) => n + r.toggles.filter((t) => entities[t.entityId]?.state === "on").length, 0);
  return (
    <Panel title="Rooms" icon={LayoutGrid} accent={C.cyan} delay={delay} className={className} right={<span className="dx-num text-[10.5px] text-dx-faint">{total} on</span>}>
      <div className="flex flex-col">
        {CURATED_ROOMS.map((room, i) => {
          const color = ROOM_NEON()[i % 8];
          const on = room.toggles.filter((t) => entities[t.entityId]?.state === "on").length;
          return (
            <div key={room.key} className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 border-b border-dashed border-dx-line py-2 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold text-dx-text">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? color : C.faint, boxShadow: on ? `0 0 6px ${color}` : undefined }} />
                  {room.name}
                </div>
                <div className="dx-num pl-3 text-[10px] text-dx-faint">
                  {on}/{room.toggles.length}
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {room.toggles.map((t) => (
                  <Cell key={t.entityId} entityId={t.entityId} label={t.label} icon={t.icon} color={color} />
                ))}
                {room.lights && entities[room.lights] && (
                  <button
                    onClick={() => setSheet({ room, color })}
                    title="Hue lights"
                    className="flex items-center gap-1 rounded-[5px] border border-dashed border-dx-line px-2 py-[5px] text-[11px] text-dx-dim hover:text-dx-text"
                  >
                    <SlidersHorizontal size={12} />
                    <span className="dx-num" style={{ color: entities[room.lights]?.state === "on" ? color : undefined }}>
                      {entities[room.lights]?.state === "on"
                        ? `${Math.round(((entities[room.lights]?.attributes.brightness as number | undefined) ?? 0) / 2.55)}%`
                        : "hue"}
                    </span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {sheet && <LightSheet groupId={sheet.room.lights!} roomName={sheet.room.name} accent={sheet.color} onClose={() => setSheet(null)} />}
    </Panel>
  );
}

/** A room's full panel for the Rooms page: every switch with a label and
 * state, and the Hue group's dimmer. */
export function RoomPanel({ room, index }: { room: CuratedRoom; index: number }) {
  const { entities } = useHa();
  const toggle = useToggle();
  const nowMs = useNow(30_000).getTime();
  const [sheet, setSheet] = useState(false);
  const color = ROOM_NEON()[index % 8];
  const on = room.toggles.filter((t) => entities[t.entityId]?.state === "on").length;
  const hue = room.lights ? entities[room.lights] : undefined;

  return (
    <Panel
      title={room.name}
      accent={color}
      delay={index * 30}
      right={<span className="dx-num text-[10.5px]" style={{ color: on ? color : C.faint }}>{on}/{room.toggles.length} on</span>}
    >
      <div className="flex flex-col">
        {room.toggles.map((t) => {
          const s = entities[t.entityId]?.state;
          const dead = s === undefined || s === "unavailable";
          const isOn = s === "on";
          const since = entities[t.entityId]?.last_changed;
          return (
            <div key={t.entityId} className="flex items-center gap-2.5 border-b border-dashed border-dx-line py-2 last:border-0">
              <t.icon size={14} style={{ color: isOn ? color : C.faint }} className={clsx(isOn && t.icon === Fan && "animate-spin [animation-duration:2s]")} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-dx-text">{t.label}</div>
                <div className="dx-num text-[10px] text-dx-faint">
                  {dead ? "unavailable" : `${isOn ? "on" : "off"} ${since ? dur(nowMs - new Date(since).getTime()) : ""}`}
                </div>
              </div>
              <Switch on={isOn} disabled={dead} color={color} label={t.label} onChange={() => toggle(t.entityId)} />
            </div>
          );
        })}
        {hue && (
          <div className="mt-2 flex items-center gap-2.5 rounded-md border border-dx-line bg-white/[0.02] px-2.5 py-2">
            <button onClick={() => setSheet(true)} title="Colors, scenes and bulbs" className="text-dx-dim hover:text-dx-text">
              <SlidersHorizontal size={14} />
            </button>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dx-dim">Hue</span>
            <Dimmer entityId={room.lights!} color={color} />
          </div>
        )}
      </div>
      {sheet && <LightSheet groupId={room.lights!} roomName={room.name} accent={color} onClose={() => setSheet(false)} />}
    </Panel>
  );
}

/** What's on, grouped by room, each with an off button. */
export function OnNowPanel({ delay = 0, className }: { delay?: number; className?: string }) {
  const { callService } = useHa();
  const { items, allOff, away } = useOnNow();
  const off = (ids: string[]) => callService("homeassistant", "turn_off", {}, { entity_id: ids }).catch(() => {});
  return (
    <Panel
      title="Powered on"
      icon={Power}
      accent={C.amber}
      delay={delay}
      className={className}
      bodyClassName="flex flex-col p-0"
      right={<span className="dx-num text-[10.5px]" style={{ color: away && items.length ? C.amber : C.faint }}>{items.length}{away ? " · away" : ""}</span>}
    >
      <div className="dx-scroll min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {items.length === 0 && <div className="py-6 text-center text-[12px] text-dx-dim">Everything is off.</div>}
        {items.map((i) => (
          <div key={i.entityId} className="group flex items-center gap-2.5 border-b border-dashed border-dx-line py-[7px] text-[12px] last:border-0">
            <i.icon size={13} style={{ color: i.outdoor ? C.cyan : C.amber }} />
            <span className="w-[92px] shrink-0 truncate text-[10.5px] uppercase tracking-[0.08em] text-dx-faint">{i.room}</span>
            <span className="min-w-0 flex-1 truncate text-dx-text">
              {i.label}
              {i.detail && <span className="dx-num ml-1.5 text-dx-dim">{i.detail}</span>}
            </span>
            <Btn onClick={() => off([i.entityId])} className="opacity-60 group-hover:opacity-100">
              Off
            </Btn>
          </div>
        ))}
      </div>
      {allOff.length > 1 && (
        <div className="border-t border-dx-line p-3">
          <Btn color={C.amber} className="w-full py-1.5" onClick={() => off(allOff.map((i) => i.entityId))}>
            <Power size={12} /> Turn off {allOff.length} indoor
          </Btn>
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- TVs */

export function TvPanel({ delay = 0 }: { delay?: number }) {
  const { entities, callService } = useHa();
  const tvs = CURATED_TVS.filter((t) => entities[t.remote] || entities[t.player]);
  if (tvs.length === 0) return null;
  return (
    <Panel title="Screens" icon={Tv} accent={C.violet} delay={delay}>
      <div className="flex flex-col gap-3">
        {tvs.map((tv) => {
          const remote = entities[tv.remote];
          const player = entities[tv.player];
          const on = remote?.state === "on" || (!!player && !["off", "unavailable", "standby"].includes(player.state));
          const app = (player?.attributes.app_name as string | undefined) ?? (remote?.attributes.current_activity as string | undefined);
          const title = player?.attributes.media_title as string | undefined;
          const r = (service: string, data: Record<string, unknown> = {}) => callService("remote", service, data, { entity_id: tv.remote }).catch(() => {});
          const key = (command: string) => r("send_command", { command });
          return (
            <div key={tv.key} className="rounded-md border border-dx-line bg-white/[0.015] p-3">
              <div className="flex items-center gap-2">
                <Dot color={on ? C.violet : C.faint} pulse={player?.state === "playing"} />
                <span className="flex-1 truncate text-[12.5px] font-semibold text-dx-text">{tv.name}</span>
                <Switch on={on} color={C.violet} label={`${tv.name} power`} onChange={() => r(on ? "turn_off" : "turn_on")} />
              </div>
              <div className="dx-num mt-1 truncate pl-4 text-[11px] text-dx-dim">{on ? [app, title].filter(Boolean).join(" · ") || "on" : "standby"}</div>
              {on && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-4">
                  <Btn onClick={() => key("MEDIA_PLAY_PAUSE")} title="Play / pause">
                    {player?.state === "playing" ? <Pause size={12} /> : <Play size={12} />}
                  </Btn>
                  <Btn onClick={() => key("VOLUME_DOWN")} title="Volume down">
                    <Volume1 size={12} />
                  </Btn>
                  <Btn onClick={() => key("VOLUME_UP")} title="Volume up">
                    <Volume2 size={12} />
                  </Btn>
                  <select
                    aria-label="Launch app"
                    value=""
                    onChange={(e) => e.target.value && r("turn_on", { activity: e.target.value })}
                    className="rounded-md border border-dx-line bg-dx-raise px-2 py-1 text-[11px] text-dx-dim outline-none"
                  >
                    <option value="">Launch app…</option>
                    {TV_APPS.map((a) => (
                      <option key={a.name} value={a.activity}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------- Vacuum */

export function VacuumPanel({ delay = 0 }: { delay?: number }) {
  const { entities, callService } = useHa();
  const nowMs = useNow(60_000).getTime();
  const P = CURATED_VACUUM.prefix;
  const v = entities[`vacuum.${P}`];
  if (!v) return null;
  const s = (k: string) => entities[`sensor.${P}_${k}`]?.state;
  const battery = num(entities[`sensor.${P}_battery`]);
  const progress = Number(s("cleaning_progress"));
  const call = (service: string) => callService("vacuum", service, {}, { entity_id: `vacuum.${P}` }).catch(() => {});
  const cleaning = v.state === "cleaning";
  return (
    <Panel title={CURATED_VACUUM.name} icon={Bot} accent={C.green} delay={delay} right={<span className="text-[10.5px] uppercase tracking-[0.12em] text-dx-dim">{v.state.replace(/_/g, " ")}</span>}>
      <div className="flex items-center gap-4">
        <Ring value={battery} label="Battery" color={C.green} size={76} />
        <div className="min-w-0 flex-1">
          <KV k="Status" v={(s("status") ?? v.state).replace(/_/g, " ")} />
          {cleaning && <KV k="Room" v={s("current_room") ?? "—"} />}
          {cleaning && Number.isFinite(progress) && <KV k="Progress" v={`${progress}%`} color={C.green} />}
          {!cleaning && s("last_clean_end") && <KV k="Last clean" v={dur(nowMs - new Date(s("last_clean_end")!).getTime()) + " ago"} />}
          <div className="mt-2.5 flex gap-1.5">
            {cleaning ? (
              <Btn color={C.amber} onClick={() => call("pause")}>
                <Pause size={12} /> Pause
              </Btn>
            ) : (
              <Btn color={C.green} onClick={() => call("start")}>
                <Play size={12} /> Clean
              </Btn>
            )}
            <Btn onClick={() => call("return_to_base")}>Dock</Btn>
            <Btn onClick={() => call("locate")}>Locate</Btn>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------- Sprinklers */

export function SprinklerPanel({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const toggle = useToggle();
  const nowMs = useNow(30_000).getTime();
  const S = CURATED_SPRINKLERS;
  const zones = S.zones.filter((z) => entities[z.entityId]);
  if (zones.length === 0) return null;
  const wet = entities[S.rainSensor]?.state === "on";
  return (
    <Panel title="Irrigation" icon={Sprout} accent={C.green} delay={delay} right={wet ? <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dx-cyan">rain sensed</span> : undefined}>
      <Label className="mb-1">Zones</Label>
      {zones.map((z) => {
        const on = entities[z.entityId]?.state === "on";
        return (
          <div key={z.entityId} className="flex items-center gap-2.5 border-b border-dashed border-dx-line py-[7px] last:border-0">
            <Droplets size={13} style={{ color: on ? C.cyan : C.faint }} />
            <span className="flex-1 truncate text-[12px] text-dx-text">{z.name}</span>
            {on && <span className="dx-num text-[10.5px] text-dx-cyan">{dur(nowMs - new Date(entities[z.entityId]!.last_changed).getTime())}</span>}
            <Switch on={on} color={C.cyan} label={z.name} onChange={() => toggle(z.entityId)} />
          </div>
        );
      })}
      <div className="mt-3 grid grid-cols-2 gap-x-4">
        {[
          { id: S.rainDelay, label: "Rain delay 24h" },
          { id: S.standby, label: "Standby" },
        ].map((x) =>
          entities[x.id] ? (
            <div key={x.id} className="flex items-center gap-2 py-1">
              <span className="flex-1 text-[11.5px] text-dx-dim">{x.label}</span>
              <Switch on={entities[x.id]?.state === "on"} color={C.amber} label={x.label} onChange={() => toggle(x.id)} />
            </div>
          ) : null,
        )}
      </div>
      <Label className="mb-1 mt-3">Schedules</Label>
      <div className="flex flex-wrap gap-1.5">
        {S.schedules
          .filter((s) => entities[s.entityId])
          .map((s) => {
            const on = entities[s.entityId]?.state === "on";
            return (
              <span key={s.entityId} className="rounded-sm border px-1.5 py-0.5 text-[10.5px]" style={on ? { color: C.green, borderColor: `${C.green}66` } : { color: C.faint, borderColor: "rgb(var(--dx-ink) / 0.07)" }}>
                {s.name}
              </span>
            );
          })}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- Climate */

const MODE_LABEL: Record<string, string> = { off: "Off", heat: "Heat", cool: "Cool", heat_cool: "Auto", auto: "Auto", fan_only: "Fan", dry: "Dry" };

export function ClimatePanel({ delay = 0, className }: { delay?: number; className?: string }) {
  const { entities, callService } = useHa();
  const e = entities[CURATED_CLIMATE_ENTITY];
  const [draft, setDraft] = useState<Record<string, number>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const a = e?.attributes ?? {};
  const haKey = `${a.temperature}|${a.target_temp_low}|${a.target_temp_high}`;
  const [seenKey, setSeenKey] = useState(haKey);
  if (haKey !== seenKey) {
    setSeenKey(haKey);
    setDraft({});
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  const temp24 = useEntityHistory(DESKTOP_INDOOR.temperature, 24, 96);
  if (!e) return null;

  const mode = e.state;
  const step = (a.target_temp_step as number | undefined) ?? 1;
  const isRange = typeof a.target_temp_low === "number" && typeof a.target_temp_high === "number";
  const keys = isRange ? ["target_temp_low", "target_temp_high"] : ["temperature"];
  const val = (k: string) => draft[k] ?? (a[k] as number | undefined);
  const action = a.hvac_action as string | undefined;
  const actionColor = action === "cooling" ? C.cyan : action === "heating" ? C.pink : C.faint;

  function nudge(k: string, d: number) {
    const base = val(k);
    if (typeof base !== "number") return;
    const next = { ...draft, [k]: base + d };
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const data = isRange
        ? { target_temp_low: next.target_temp_low ?? a.target_temp_low, target_temp_high: next.target_temp_high ?? a.target_temp_high }
        : { temperature: next.temperature };
      callService("climate", "set_temperature", data, { entity_id: CURATED_CLIMATE_ENTITY }).catch(() => setDraft({}));
    }, 600);
  }

  return (
    <Panel
      title="Thermostat"
      icon={Thermometer}
      accent={C.violet}
      delay={delay}
      className={className}
      right={
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: actionColor }}>
          <Dot color={actionColor} pulse={action === "cooling" || action === "heating"} /> {action ?? mode}
        </span>
      }
    >
      <div className="flex items-start gap-6">
        <div>
          <Label>Inside</Label>
          <Big value={(a.current_temperature as number | undefined)?.toFixed?.(1) ?? "—"} unit="°" size={44} />
          {a.current_humidity !== undefined && <div className="dx-num text-[11px] text-dx-dim">{String(a.current_humidity)}% rh</div>}
        </div>
        {mode !== "off" &&
          keys.map((k) => (
            <div key={k}>
              <Label>{k === "target_temp_low" ? "Heat to" : k === "target_temp_high" ? "Cool to" : "Target"}</Label>
              <div className="flex items-center gap-2">
                <button onClick={() => nudge(k, -step)} aria-label="Lower" className="rounded border border-dx-line p-1 text-dx-dim hover:text-dx-text">
                  <Minus size={13} />
                </button>
                <Big value={val(k) ?? "—"} unit="°" color={k === "target_temp_low" ? C.pink : C.cyan} size={44} />
                <button onClick={() => nudge(k, step)} aria-label="Raise" className="rounded border border-dx-line p-1 text-dx-dim hover:text-dx-text">
                  <Plus size={13} />
                </button>
              </div>
            </div>
          ))}
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <Label className="w-10">Mode</Label>
          <div className="flex-1">
            <Segmented
              value={mode}
              onChange={(m) => callService("climate", "set_hvac_mode", { hvac_mode: m }, { entity_id: CURATED_CLIMATE_ENTITY }).catch(() => {})}
              options={((a.hvac_modes as string[] | undefined) ?? [mode]).map((m) => ({ value: m, label: MODE_LABEL[m] ?? m }))}
            />
          </div>
        </div>
        {Array.isArray(a.fan_modes) && (
          <div className="flex items-center gap-3">
            <Label className="w-10">Fan</Label>
            <div className="flex-1">
              <Segmented
                value={a.fan_mode as string}
                onChange={(f) => callService("climate", "set_fan_mode", { fan_mode: f }, { entity_id: CURATED_CLIMATE_ENTITY }).catch(() => {})}
                options={(a.fan_modes as string[]).map((f) => ({ value: f, label: f }))}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <LineChart hours={24} height={90} format={(v) => `${v.toFixed(1)}°`} series={temp24 ? [{ label: "Inside", values: temp24, color: C.violet, fill: true }] : []} />
      </div>
    </Panel>
  );
}
