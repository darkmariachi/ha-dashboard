import {
  DoorClosed,
  DoorOpen,
  Flame,
  Music,
  Power,
  Snowflake,
  Sparkles,
  Sun,
  Thermometer,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import {
  CURATED_CLIMATE_ENTITY,
  CURATED_DOOR_SENSORS,
  CURATED_ENERGY,
  CURATED_QUICK_ACTIONS,
  type QuickAction,
} from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import type { RoomColor } from "../../lib/roomPalette";
import { roomColorFor } from "../../lib/roomPalette";
import { useNow } from "../../lib/useNow";
import { ClimateControlModal } from "../climate/ClimateControlModal";
import { DoorsModal } from "./DoorsModal";
import { OnNowModal, useOnNow } from "./OnNowModal";
import { PowerModal } from "./PowerModal";
import { AnimatedNumber } from "./AnimatedNumber";
import { QuickActionToast } from "./QuickActionToast";
import { Sparkline } from "./Sparkline";
import { SpotifySearchModal } from "./SpotifySearchModal";
import { useEntityHistory } from "./useEntityHistory";
import { useSpotifyNowPlaying } from "./useSpotifyNowPlaying";

const DOORS_COLOR = roomColorFor(1);
const DOOR_OPEN_COLOR: RoomColor = { tint: "#ffe2c2", accent: "#d9822b" };
const SOLAR_GREEN = "#2f9e6f";
const ON_NOW_COLOR = roomColorFor(0);
const POWER_COLOR = roomColorFor(4);
const CLIMATE_COLOR = roomColorFor(5);
const ACTIONS_COLOR = roomColorFor(2);
/** Per-action icon color on the Quick Actions tile, by action key. */
const ACTION_ACCENTS: Record<string, string> = {
  leaving: roomColorFor(4).accent,
  party: roomColorFor(5).accent,
  good_night: roomColorFor(3).accent,
};
const SPOTIFY_GREEN = "#1DB954";

function TileHeader({ icon: Icon, label, color }: { icon: LucideIcon; label: string; color: RoomColor }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px]"
        style={{ background: color.tint, color: color.accent }}
      >
        <Icon size={17} />
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">
        {label}
      </span>
    </div>
  );
}

const tileClass = "glass rise flex min-h-[128px] flex-col gap-2 rounded-[26px] px-5 py-[18px] text-left";

/** Big light-weight number with a small unit beside it. */
function BigValue({ children, unit }: { children: React.ReactNode; unit?: string }) {
  return (
    <div className="text-[40px] font-light leading-none tracking-[-1.5px] text-text tabular-nums">
      {children}
      {unit && <small className="ml-1 text-base font-medium tracking-normal text-text-dim">{unit}</small>}
    </div>
  );
}

/** W readings of 1000+ read better as kW on a glance-at display. */
function powerParts(state: string, unit: string | undefined) {
  const n = parseFloat(state);
  if (!Number.isFinite(n)) return null;
  if (unit === "W" && Math.abs(n) >= 1000) return { value: n / 1000, decimals: 2, unit: "kW" };
  return { value: n, decimals: unit === "W" ? 0 : 2, unit: unit ?? "" };
}

function PowerTile({ className, onOpen }: { className?: string; onOpen: () => void }) {
  const { entities } = useHa();
  const consumption = entities[CURATED_ENERGY.consumption];
  const production = entities[CURATED_ENERGY.production];
  const history = useEntityHistory(CURATED_ENERGY.consumption);
  const parts = consumption
    ? powerParts(consumption.state, consumption.attributes.unit_of_measurement as string | undefined)
    : null;
  const solar = production
    ? powerParts(production.state, production.attributes.unit_of_measurement as string | undefined)
    : null;

  return (
    <button
      onClick={onOpen}
      className={clsx(tileClass, "cursor-pointer transition-transform active:scale-[0.98]", className)}
      style={{ animationDelay: "80ms" }}
    >
      <TileHeader icon={Zap} label="Power" color={POWER_COLOR} />
      <BigValue unit={parts?.unit}>
        {parts ? <AnimatedNumber value={parts.value} decimals={parts.decimals} /> : "—"}
      </BigValue>
      {solar && (
        <div className="flex items-center gap-1 text-[13px] font-semibold" style={{ color: SOLAR_GREEN }}>
          <Sun size={14} />
          Solar {solar.value.toFixed(solar.decimals)} {solar.unit}
        </div>
      )}
      <div className="mt-auto">
        {history ? (
          <Sparkline values={history} color={POWER_COLOR.accent} />
        ) : (
          <div className="text-[13px] text-text-dim">Using now</div>
        )}
      </div>
    </button>
  );
}

const HVAC_STYLES: Record<string, { icon: LucideIcon; bg: string; fg: string }> = {
  cool: { icon: Snowflake, bg: "#dceafe", fg: "#2f5fae" },
  heat: { icon: Flame, bg: "#ffe6d2", fg: "#b9621d" },
  heat_cool: { icon: Thermometer, bg: "#e9e2fb", fg: "#6a4fc0" },
  auto: { icon: Thermometer, bg: "#e9e2fb", fg: "#6a4fc0" },
  fan_only: { icon: Wind, bg: "#dcf5e8", fg: "#2b7f5a" },
  dry: { icon: Wind, bg: "#fff1d6", fg: "#9a6a12" },
};

function ClimateTile({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const { entities } = useHa();
  const climate = entities[CURATED_CLIMATE_ENTITY];
  const current = climate?.attributes.current_temperature as number | undefined;
  const mode = climate?.state;
  const style = mode ? HVAC_STYLES[mode] : undefined;
  const target = climate?.attributes.temperature as number | undefined;
  const low = climate?.attributes.target_temp_low as number | undefined;
  const high = climate?.attributes.target_temp_high as number | undefined;
  const targetText =
    target !== undefined ? `${target}°` : low !== undefined && high !== undefined ? `${low}–${high}°` : null;
  const modeText = mode ? mode.replace(/_/g, " ") : "—";
  const fanMode = climate?.attributes.fan_mode as string | undefined;

  return (
    <button
      onClick={climate ? onOpen : undefined}
      className={clsx(tileClass, climate && "cursor-pointer transition-transform active:scale-[0.98]", className)}
      style={{ animationDelay: "140ms" }}
    >
      <TileHeader icon={Thermometer} label="Climate" color={CLIMATE_COLOR} />
      <div className="flex items-end justify-between gap-2">
        <BigValue unit="°">{current ?? "—"}</BigValue>
        {mode && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold capitalize"
            style={style ? { background: style.bg, color: style.fg } : undefined}
          >
            {style && <style.icon size={13} />}
            {modeText}
            {mode !== "off" && targetText && ` · ${targetText}`}
          </span>
        )}
      </div>
      <div className="mt-auto text-[13px] text-text-dim">
        Inside{fanMode ? ` · fan ${fanMode}` : ""}
      </div>
    </button>
  );
}

function QuickActionsTile({
  onRun,
  className,
}: {
  onRun: (action: QuickAction) => void;
  className?: string;
}) {
  return (
    <div className={clsx(tileClass, className)} style={{ animationDelay: "200ms" }}>
      <TileHeader icon={Sparkles} label="Quick actions" color={ACTIONS_COLOR} />
      <div className="mt-auto flex gap-2">
        {CURATED_QUICK_ACTIONS.map((action) => {
          const empty = action.entityIds.length === 0;
          return (
            <button
              key={action.key}
              onClick={() => onRun(action)}
              disabled={empty}
              title={empty ? "No entities configured for this action yet" : action.description}
              className="flex flex-1 flex-col items-center gap-1.5 rounded-2xl px-1.5 py-2.5 text-center text-xs font-semibold leading-tight text-text transition-transform active:scale-95 disabled:opacity-40"
              style={{ background: "var(--chip-off)" }}
            >
              <action.icon size={20} style={{ color: ACTION_ACCENTS[action.key] ?? ACTIONS_COLOR.accent }} />
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SpotifyTile({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const player = useSpotifyNowPlaying();
  const track = player?.item;
  const art = track?.album.images[0]?.url;
  const progress =
    track?.duration_ms && player?.progress_ms !== undefined
      ? Math.min(100, (player.progress_ms / track.duration_ms) * 100)
      : null;

  return (
    <button
      onClick={onOpen}
      className={clsx(
        tileClass,
        "relative flex-row items-center gap-4 overflow-hidden p-4 transition-transform active:scale-[0.98]",
        className,
      )}
      style={{ animationDelay: "260ms" }}
    >
      {/* Album art, heavily blurred, as the tile's own backdrop. */}
      {art && (
        <img
          src={art}
          alt=""
          aria-hidden
          className="pointer-events-none absolute -inset-8 h-[calc(100%+4rem)] w-[calc(100%+4rem)] object-cover opacity-50 blur-[36px]"
        />
      )}

      <div
        className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white shadow-[0_10px_24px_-8px_rgba(0,0,0,0.45)]"
        style={{ background: art ? undefined : `linear-gradient(135deg, ${SPOTIFY_GREEN}, #169c46)` }}
      >
        {art ? <img src={art} alt="" className="h-full w-full object-cover" /> : <Music size={36} />}
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">
          <span className="h-2 w-2 rounded-full" style={{ background: SPOTIFY_GREEN }} />
          {track ? (player?.is_playing ? "Now playing" : "Paused") : "Spotify"}
        </span>
        <b className="truncate text-[17px] font-semibold text-text">{track ? track.name : "Nothing playing"}</b>
        <span className="truncate text-[13px] text-text-dim">
          {track ? track.artists.map((a) => a.name).join(", ") : "Tap to search and play"}
        </span>
        {progress !== null && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-text-dim/25">
            <div
              className="h-full rounded-full bg-text transition-[width] duration-1000 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </button>
  );
}

function minutesAgo(iso: string, now: Date) {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return `${hours} h ${mins % 60} min`;
}

/** Open/closed at a glance for the same door sensors DoorAlertMonitor
 * watches — the thing you most want to check from your phone. */
function DoorsTile({ className, onOpen }: { className?: string; onOpen: () => void }) {
  const { entities } = useHa();
  const now = useNow(30_000);
  const doors = CURATED_DOOR_SENSORS.map((d) => ({ ...d, entity: entities[d.entityId] }));
  const open = doors.filter((d) => d.entity?.state === "on");
  const unknown = doors.filter((d) => !d.entity || d.entity.state === "unavailable");
  const anyOpen = open.length > 0;

  return (
    <button
      onClick={onOpen}
      className={clsx(tileClass, "cursor-pointer transition-transform active:scale-[0.98]", className)}
      style={{
        animationDelay: "170ms",
        ...(anyOpen && {
          borderColor: `${DOOR_OPEN_COLOR.accent}8c`,
          boxShadow: `var(--glass-shadow), 0 0 0 1px ${DOOR_OPEN_COLOR.accent}4d, 0 0 34px -6px ${DOOR_OPEN_COLOR.accent}8c`,
        }),
      }}
    >
      <TileHeader
        icon={anyOpen ? DoorOpen : DoorClosed}
        label="Doors"
        color={anyOpen ? DOOR_OPEN_COLOR : DOORS_COLOR}
      />
      <div
        className="text-[28px] font-light leading-tight tracking-[-0.8px] text-text"
        style={anyOpen ? { color: DOOR_OPEN_COLOR.accent, fontWeight: 500 } : undefined}
      >
        {anyOpen ? `${open.length} open` : "All closed"}
      </div>
      <div className="mt-auto flex flex-col gap-0.5 text-[13px] text-text-dim">
        {anyOpen
          ? open.map((d) => (
              <span key={d.entityId} className="truncate">
                {d.label} · {minutesAgo(d.entity!.last_changed, now)}
              </span>
            ))
          : `${doors.length - unknown.length} of ${doors.length} reporting`}
      </div>
    </button>
  );
}

/** What's on around the house, and a way to turn it off — for checking from
 * the phone after leaving. Glows amber when things are on with nobody home. */
function OnNowTile({ className, onOpen }: { className?: string; onOpen: () => void }) {
  const { items, indoor, away } = useOnNow();
  const leftOn = away && indoor.length > 0;
  const byRoom = new Map<string, number>();
  for (const item of items) byRoom.set(item.room, (byRoom.get(item.room) ?? 0) + 1);

  return (
    <button
      onClick={items.length > 0 ? onOpen : undefined}
      className={clsx(tileClass, items.length > 0 && "cursor-pointer transition-transform active:scale-[0.98]", className)}
      style={{
        animationDelay: "110ms",
        ...(leftOn && {
          borderColor: `${DOOR_OPEN_COLOR.accent}8c`,
          boxShadow: `var(--glass-shadow), 0 0 0 1px ${DOOR_OPEN_COLOR.accent}4d, 0 0 34px -6px ${DOOR_OPEN_COLOR.accent}8c`,
        }),
      }}
    >
      <TileHeader icon={Power} label="On right now" color={leftOn ? DOOR_OPEN_COLOR : ON_NOW_COLOR} />
      <div
        className="text-[28px] font-light leading-tight tracking-[-0.8px] text-text"
        style={leftOn ? { color: DOOR_OPEN_COLOR.accent, fontWeight: 500 } : undefined}
      >
        {items.length === 0 ? "Everything's off" : `${items.length} ${items.length === 1 ? "thing" : "things"} on`}
      </div>
      {items.length > 0 && (
        <div className="mt-auto truncate text-[13px] text-text-dim">
          {leftOn && "Nobody's home · "}
          {[...byRoom].map(([room, n]) => `${room} ${n}`).join(" · ")}
        </div>
      )}
    </button>
  );
}

export function StatusBar({ variant = "tablet" }: { variant?: "tablet" | "phone" }) {
  const { entities, callService } = useHa();
  const [climateOpen, setClimateOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [onNowOpen, setOnNowOpen] = useState(false);
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const [toastAction, setToastAction] = useState<QuickAction | null>(null);
  // Bumped on every tap so re-tapping the same action while its toast is
  // already showing remounts QuickActionToast (fresh animation + timer)
  // instead of silently reusing the still-running one.
  const [toastNonce, setToastNonce] = useState(0);
  const climate = entities[CURATED_CLIMATE_ENTITY];

  function runAction(action: QuickAction) {
    if (action.entityIds.length === 0) return;
    callService("homeassistant", action.action, {}, { entity_id: action.entityIds }).catch(
      () => {},
    );
    setToastAction(action);
    setToastNonce((n) => n + 1);
  }

  return (
    <div
      className={
        variant === "phone"
          ? "grid grid-cols-2 gap-3"
          : "grid grid-cols-2 gap-4 lg:grid-cols-[1fr_1fr_1fr_1.25fr_1.5fr]"
      }
    >
      {variant === "phone" ? (
        // Phone: actions first (most-used one-handed), then the glanceable
        // tiles side by side, then doors and music full width.
        <>
          <QuickActionsTile onRun={runAction} className="col-span-2 min-h-0" />
          <OnNowTile className="col-span-2 min-h-0" onOpen={() => setOnNowOpen(true)} />
          <PowerTile onOpen={() => setPowerOpen(true)} />
          <ClimateTile onOpen={() => setClimateOpen(true)} />
          <DoorsTile className="col-span-2 min-h-0" onOpen={() => setDoorsOpen(true)} />
          <SpotifyTile onOpen={() => setSpotifyOpen(true)} className="col-span-2" />
        </>
      ) : (
        <>
          <PowerTile onOpen={() => setPowerOpen(true)} />
          <ClimateTile onOpen={() => setClimateOpen(true)} />
          <DoorsTile onOpen={() => setDoorsOpen(true)} />
          <QuickActionsTile onRun={runAction} />
          <SpotifyTile onOpen={() => setSpotifyOpen(true)} className="max-lg:col-span-2" />
        </>
      )}

      {climateOpen && climate && (
        <ClimateControlModal
          entityId={CURATED_CLIMATE_ENTITY}
          onClose={() => setClimateOpen(false)}
        />
      )}

      {spotifyOpen && <SpotifySearchModal onClose={() => setSpotifyOpen(false)} />}
      {powerOpen && <PowerModal onClose={() => setPowerOpen(false)} />}
      {doorsOpen && <DoorsModal onClose={() => setDoorsOpen(false)} />}
      {onNowOpen && <OnNowModal onClose={() => setOnNowOpen(false)} />}

      {toastAction && (
        <QuickActionToast
          key={`${toastAction.key}-${toastNonce}`}
          action={toastAction}
          onDismiss={() => setToastAction(null)}
        />
      )}
    </div>
  );
}
