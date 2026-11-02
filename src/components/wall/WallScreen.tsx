import { createElement, useState } from "react";
import clsx from "clsx";
import { DoorClosed, DoorOpen, Fan, Power, SunDim, Thermometer, Zap, type LucideIcon } from "lucide-react";
import {
  CURATED_CLIMATE_ENTITY,
  CURATED_DOOR_SENSORS,
  CURATED_ENERGY,
  CURATED_QUICK_ACTIONS,
  CURATED_ROOMS,
  CURATED_WEATHER_ENTITY,
  HOUSEHOLD_PEOPLE,
  type CuratedRoom,
  type QuickAction,
} from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { roomColorFor, tintedGlass } from "../../lib/roomPalette";
import { useNow } from "../../lib/useNow";
import { isNightFor } from "../../lib/weatherTheme";
import { ClimateControlModal } from "../climate/ClimateControlModal";
import { ROOM_ILLUSTRATIONS } from "../illustrations/RoomIllustrations";
import { DoorsModal } from "../home/DoorsModal";
import { IconToggleButton } from "../home/IconToggleButton";
import { LightSheet } from "../home/LightSheet";
import { OnNowModal, useOnNow } from "../home/OnNowModal";
import { PowerModal } from "../home/PowerModal";
import { QuickActionToast } from "../home/QuickActionToast";
import { HVAC_STYLES, powerParts, weatherIcon, weatherLabel } from "../home/statusIcons";
import { useWeatherForecast } from "../home/useWeatherForecast";
import { WeatherBackground } from "../home/WeatherBackground";

const HOME_GREEN = "#3ee08f";
const ALERT = "#d9822b";
const ACTION_ACCENTS: Record<string, string> = {
  leaving: roomColorFor(4).accent,
  party: roomColorFor(5).accent,
  good_night: roomColorFor(3).accent,
};

function Clock() {
  const now = useNow(1000);
  const h = now.getHours();
  return (
    <div>
      <div className="text-[64px] font-light leading-[0.9] tracking-[-2.5px] tabular-nums">
        {((h + 11) % 12) + 1}:{String(now.getMinutes()).padStart(2, "0")}
        <span className="ml-1 text-[20px] font-normal tracking-normal opacity-85">{h < 12 ? "AM" : "PM"}</span>
      </div>
      <div className="mt-1.5 text-[13px] opacity-85">
        {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}

function Weather() {
  const { entities } = useHa();
  const weather = entities[CURATED_WEATHER_ENTITY];
  const hourly = useWeatherForecast(CURATED_WEATHER_ENTITY, "hourly");
  const daily = useWeatherForecast(CURATED_WEATHER_ENTITY, "daily");
  const now = useNow(60_000);
  if (!weather) return null;

  const temp = weather.attributes.temperature as number | undefined;
  const today = daily?.[0];
  const nextHours = (hourly ?? []).filter((f) => new Date(f.datetime).getTime() > now.getTime()).slice(0, 4);
  const round = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v)}°`);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        {createElement(weatherIcon(weather.state), { size: 34, strokeWidth: 1.5 })}
        <div className="text-[38px] font-light leading-none tracking-[-1.5px]">{round(temp)}</div>
        <div className="min-w-0 text-[12px] leading-snug opacity-90">
          <div className="truncate text-[13px] font-semibold">{weatherLabel(weather.state)}</div>
          {today && (
            <div>
              H {round(today.temperature)} · L {round(today.templow)}
            </div>
          )}
        </div>
      </div>
      {nextHours.length > 0 && (
        <div className="flex justify-between rounded-[16px] border border-white/25 bg-white/15 px-2 py-1.5 [text-shadow:none] backdrop-blur-md">
          {nextHours.map((f) => (
            <div key={f.datetime} className="flex w-[46px] flex-col items-center gap-0.5 text-[11px]">
              {new Date(f.datetime).toLocaleTimeString(undefined, { hour: "numeric" })}
              {createElement(weatherIcon(f.condition), { size: 16 })}
              <b className="text-[12px] font-semibold">{round(f.temperature)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function People() {
  const { entities, hassUrl } = useHa();
  return (
    <div className="flex gap-1.5 [text-shadow:none]">
      {HOUSEHOLD_PEOPLE.map((id) => {
        const person = entities[id];
        if (!person) return null;
        const name = ((person.attributes.friendly_name as string | undefined) ?? id.split(".")[1]).split(" ")[0];
        const picture = person.attributes.entity_picture as string | undefined;
        const home = person.state === "home";
        return (
          <div
            key={id}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-white/25 bg-white/15 py-0.5 pl-0.5 pr-2.5 text-white backdrop-blur-md"
          >
            <div className="relative h-7 w-7 shrink-0">
              {picture ? (
                <img
                  src={`${hassUrl ?? ""}${picture}`}
                  alt=""
                  className={clsx("h-full w-full rounded-full object-cover", !home && "opacity-70 grayscale")}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-full bg-white/25 text-xs font-semibold">
                  {name.charAt(0)}
                </div>
              )}
              <span
                className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-[1.5px] border-white/90"
                style={{ background: home ? HOME_GREEN : "#9aa1b5" }}
              />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[12px] font-semibold">{name}</div>
              <div className="text-[10px] opacity-85">{home ? "Home" : "Away"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One glanceable number that opens the same detail sheet as its Home tile. */
function Stat({
  icon: Icon,
  label,
  value,
  color,
  alert,
  onOpen,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  color: string;
  alert?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="glass flex min-w-0 items-center gap-2 rounded-[16px] px-2.5 py-2 text-left transition-transform active:scale-[0.97]"
      style={alert ? { borderColor: `${ALERT}8c`, boxShadow: `var(--glass-shadow), 0 0 18px -4px ${ALERT}` } : undefined}
    >
      <Icon size={18} className="shrink-0" style={{ color: alert ? ALERT : color }} />
      <div className="min-w-0 leading-tight">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-text-dim">{label}</div>
        <div className="truncate text-[15px] font-medium text-text" style={alert ? { color: ALERT } : undefined}>
          {value}
        </div>
      </div>
    </button>
  );
}

function Stats() {
  const { entities } = useHa();
  const { items, indoor, away } = useOnNow();
  const [open, setOpen] = useState<"power" | "climate" | "doors" | "on" | null>(null);

  const consumption = entities[CURATED_ENERGY.consumption];
  const power = consumption
    ? powerParts(consumption.state, consumption.attributes.unit_of_measurement as string | undefined)
    : null;
  const climate = entities[CURATED_CLIMATE_ENTITY];
  const current = climate?.attributes.current_temperature as number | undefined;
  const mode = climate?.state;
  const ModeIcon = (mode && HVAC_STYLES[mode]?.icon) || Thermometer;
  const openDoors = CURATED_DOOR_SENSORS.filter((d) => entities[d.entityId]?.state === "on");
  const leftOn = away && indoor.length > 0;

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <Stat
        icon={Zap}
        label="Power"
        color={roomColorFor(4).accent}
        value={power ? `${power.value.toFixed(power.decimals)} ${power.unit}` : "—"}
        onOpen={() => setOpen("power")}
      />
      <Stat
        icon={ModeIcon}
        label="Climate"
        color={roomColorFor(5).accent}
        value={
          <>
            {current ?? "—"}°{mode && mode !== "off" && <span className="text-[11px] capitalize text-text-dim"> {mode.replace(/_/g, " ")}</span>}
          </>
        }
        onOpen={climate ? () => setOpen("climate") : undefined}
      />
      <Stat
        icon={openDoors.length ? DoorOpen : DoorClosed}
        label="Doors"
        color={roomColorFor(1).accent}
        alert={openDoors.length > 0}
        value={openDoors.length ? `${openDoors.length} open` : "All closed"}
        onOpen={() => setOpen("doors")}
      />
      <Stat
        icon={Power}
        label="On now"
        color={roomColorFor(0).accent}
        alert={leftOn}
        value={items.length ? `${items.length} on` : "All off"}
        onOpen={items.length ? () => setOpen("on") : undefined}
      />

      {open === "power" && <PowerModal onClose={() => setOpen(null)} />}
      {open === "climate" && <ClimateControlModal entityId={CURATED_CLIMATE_ENTITY} onClose={() => setOpen(null)} />}
      {open === "doors" && <DoorsModal onClose={() => setOpen(null)} />}
      {open === "on" && <OnNowModal onClose={() => setOpen(null)} />}
    </div>
  );
}

function QuickActions() {
  const { callService } = useHa();
  const [toast, setToast] = useState<{ action: QuickAction; nonce: number } | null>(null);

  function run(action: QuickAction) {
    if (action.entityIds.length === 0) return;
    callService("homeassistant", action.action, {}, { entity_id: action.entityIds }).catch(() => {});
    setToast((t) => ({ action, nonce: (t?.nonce ?? 0) + 1 }));
  }

  return (
    <div className="flex gap-1.5">
      {CURATED_QUICK_ACTIONS.map((action) => (
        <button
          key={action.key}
          onClick={() => run(action)}
          disabled={action.entityIds.length === 0}
          className="glass flex flex-1 flex-col items-center gap-1 rounded-[16px] px-1 py-2 text-[11px] font-semibold leading-tight text-text transition-transform active:scale-95 disabled:opacity-40"
        >
          <action.icon size={18} style={{ color: ACTION_ACCENTS[action.key] }} />
          <span className="w-full truncate text-center">{action.label}</span>
        </button>
      ))}
      {toast && (
        <QuickActionToast
          key={`${toast.action.key}-${toast.nonce}`}
          action={toast.action}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}

/** A room's switches in one row, with its Hue chip beside the name. */
function WallRoom({ room, index }: { room: CuratedRoom; index: number }) {
  const { entities, callService } = useHa();
  const [lightsOpen, setLightsOpen] = useState(false);
  const color = roomColorFor(index);
  const hue = room.lights ? entities[room.lights] : undefined;
  const hueOn = hue?.state === "on";
  const onCount = room.toggles.filter((t) => entities[t.entityId]?.state === "on").length;
  const Illustration = ROOM_ILLUSTRATIONS[room.illustration];

  return (
    <div
      className="glass relative flex min-h-0 flex-col gap-1.5 overflow-hidden rounded-[18px] px-2.5 pb-2 pt-2"
      style={{
        background: tintedGlass(color),
        ...(onCount > 0 && {
          borderColor: `${color.accent}8c`,
          boxShadow: `var(--glass-shadow), 0 0 0 1px ${color.accent}4d, 0 0 22px -6px ${color.accent}8c`,
        }),
      }}
    >
      <Illustration
        size={64}
        strokeWidth={1.1}
        aria-hidden
        className={clsx(
          "pointer-events-none absolute -bottom-2 -left-1",
          onCount > 0 ? "opacity-35" : "opacity-[0.18]",
        )}
        style={{ color: color.accent }}
      />

      <div className="relative flex items-center gap-1.5">
        <div className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.2px] text-text">
          {room.name}
          <span className="ml-1.5 text-[11px] font-medium text-text-dim">{onCount > 0 ? `${onCount} on` : ""}</span>
        </div>
        {hue && (
          <button
            onClick={() => setLightsOpen(true)}
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-transform active:scale-95"
            style={
              hueOn
                ? { background: color.accent, color: "#fff" }
                : { background: "var(--chip-off)", color: color.accent }
            }
          >
            <SunDim size={12} />
            {hueOn ? `${Math.round(((hue.attributes.brightness as number | undefined) ?? 0) / 2.55)}%` : "Hue"}
          </button>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 justify-end gap-1.5">
        {room.toggles.map((t) => {
          const state = entities[t.entityId]?.state;
          const unavailable = state === undefined || state === "unavailable";
          return (
            <IconToggleButton
              key={t.entityId}
              compact
              icon={t.icon}
              label={t.label}
              on={state === "on"}
              accent={unavailable ? "#b5b0a3" : color.accent}
              spinWhenOn={t.icon === Fan}
              onClick={() =>
                !unavailable && callService(t.entityId.split(".")[0], "toggle", {}, { entity_id: t.entityId }).catch(() => {})
              }
            />
          );
        })}
      </div>

      {lightsOpen && room.lights && (
        <LightSheet groupId={room.lights} roomName={room.name} accent={color.accent} onClose={() => setLightsOpen(false)} />
      )}
    </div>
  );
}

/**
 * The 7" Raspberry Pi touchscreen on the wall (800×480, testpi). Everything
 * on one screen with no scrolling: clock, weather, people, status and quick
 * actions in a left rail, and every room's switches in a grid beside it.
 * No drawer or room links on purpose — a kiosk has no back button, so
 * everything here opens as a sheet and closes back to this screen.
 */
export function WallScreen() {
  const { entities, status } = useHa();
  const weather = entities[CURATED_WEATHER_ENTITY];
  const isNight = isNightFor(entities["sun.sun"]?.state);
  const rows = Math.ceil(CURATED_ROOMS.length / 2);

  return (
    <div className={clsx("relative h-full overflow-hidden", isNight && "home-night")} data-sheet-root>
      <WeatherBackground condition={weather?.state} isNight={isNight} />

      <div className="relative grid h-full grid-cols-[236px_minmax(0,1fr)] gap-3 p-3">
        <aside className="hero-shadow flex min-h-0 flex-col gap-2.5 text-white">
          <div className="relative">
            <Clock />
            <span
              title={status}
              className={clsx(
                "absolute right-1 top-1.5 h-[7px] w-[7px] rounded-full",
                status === "connected" ? "bg-[#3ee08f] shadow-[0_0_0_4px_rgba(62,224,143,0.25)]" : "bg-warn",
              )}
            />
          </div>
          <Weather />
          <People />
          <div className="mt-auto flex flex-col gap-1.5 [text-shadow:none]">
            <Stats />
            <QuickActions />
          </div>
        </aside>

        <section className="grid min-h-0 grid-cols-2 gap-2" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
          {CURATED_ROOMS.map((room, i) => (
            <WallRoom key={room.key} room={room} index={i} />
          ))}
        </section>
      </div>
    </div>
  );
}
