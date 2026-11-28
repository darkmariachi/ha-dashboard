import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FastForward,
  Gamepad2,
  House,
  Pause,
  Play,
  Power,
  Rewind,
  Tv,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { CURATED_TVS, TV_APPS, type CuratedTv } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { Sheet, SheetSection } from "./Sheet";

const ACCENT = "#5b5bd6";
const TINT = "#dcdcfa";

/** Key names androidtv_remote's remote.send_command understands. */
type Key =
  | "DPAD_UP"
  | "DPAD_DOWN"
  | "DPAD_LEFT"
  | "DPAD_RIGHT"
  | "DPAD_CENTER"
  | "BACK"
  | "HOME"
  | "VOLUME_UP"
  | "VOLUME_DOWN"
  | "VOLUME_MUTE"
  | "MEDIA_PLAY_PAUSE"
  | "MEDIA_REWIND"
  | "MEDIA_FAST_FORWARD";

function useTv(tv: CuratedTv) {
  const { entities, callService } = useHa();
  const remote = entities[tv.remote];
  const player = entities[tv.player];
  const on = remote?.state === "on" || (player !== undefined && !["off", "unavailable", "standby"].includes(player.state));
  const available = remote !== undefined && remote.state !== "unavailable";
  const app = (player?.attributes.app_name as string | undefined) ?? (remote?.attributes.current_activity as string | undefined);
  const playing = player?.state === "playing";

  function key(command: Key, hold = false) {
    navigator.vibrate?.(8);
    callService("remote", "send_command", hold ? { command, hold_secs: 0.6 } : { command }, { entity_id: tv.remote }).catch(() => {});
  }
  function power() {
    navigator.vibrate?.(12);
    callService("remote", on ? "turn_off" : "turn_on", {}, { entity_id: tv.remote }).catch(() => {});
  }
  function launch(activity: string) {
    navigator.vibrate?.(12);
    callService("remote", "turn_on", { activity }, { entity_id: tv.remote }).catch(() => {});
  }
  return { on, available, app, playing, key, power, launch };
}

function RoundButton({
  onClick,
  label,
  children,
  big,
  accent,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  big?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        "flex items-center justify-center rounded-full transition-transform active:scale-90",
        big ? "h-14 w-14" : "h-11 w-11",
      )}
      style={accent ? { background: ACCENT, color: "#fff" } : { background: "var(--color-chip)", color: "var(--color-text)" }}
    >
      {children}
    </button>
  );
}

/** Full remote: D-pad, back/home, volume, media keys and app shortcuts. */
function RemoteSheet({ tv, onClose }: { tv: CuratedTv; onClose: () => void }) {
  const { on, app, key, power, launch } = useTv(tv);

  return (
    <Sheet title={tv.name} subtitle={on ? (app ? `On · ${app}` : "On") : "Off"} onClose={onClose}>
      <div className="flex items-center justify-between">
        <RoundButton onClick={power} label={on ? "Turn off" : "Turn on"} accent={!on}>
          <Power size={18} />
        </RoundButton>
        <div className="flex gap-2">
          <RoundButton onClick={() => key("BACK")} label="Back">
            <ArrowLeft size={18} />
          </RoundButton>
          <RoundButton onClick={() => key("HOME")} label="Home">
            <House size={18} />
          </RoundButton>
        </div>
      </div>

      {/* D-pad */}
      <div className="relative mx-auto h-56 w-56 rounded-full bg-chip">
        {(
          [
            ["DPAD_UP", "left-1/2 top-2 -translate-x-1/2", ChevronUp, "Up"],
            ["DPAD_DOWN", "bottom-2 left-1/2 -translate-x-1/2", ChevronDown, "Down"],
            ["DPAD_LEFT", "left-2 top-1/2 -translate-y-1/2", ChevronLeft, "Left"],
            ["DPAD_RIGHT", "right-2 top-1/2 -translate-y-1/2", ChevronRight, "Right"],
          ] as const
        ).map(([k, pos, Icon, label]) => (
          <button
            key={k}
            onClick={() => key(k)}
            aria-label={label}
            className={clsx("absolute flex h-16 w-16 items-center justify-center rounded-full text-text active:scale-90 active:bg-black/10", pos)}
          >
            <Icon size={28} />
          </button>
        ))}
        <button
          onClick={() => key("DPAD_CENTER")}
          aria-label="OK"
          className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-bold text-white shadow-lg active:scale-90"
          style={{ background: ACCENT }}
        >
          OK
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <RoundButton onClick={() => key("VOLUME_DOWN")} label="Volume down">
            <Volume1 size={18} />
          </RoundButton>
          <RoundButton onClick={() => key("VOLUME_MUTE")} label="Mute">
            <VolumeX size={18} />
          </RoundButton>
          <RoundButton onClick={() => key("VOLUME_UP")} label="Volume up">
            <Volume2 size={18} />
          </RoundButton>
        </div>
        <div className="flex gap-2">
          <RoundButton onClick={() => key("MEDIA_REWIND")} label="Rewind">
            <Rewind size={18} />
          </RoundButton>
          <RoundButton onClick={() => key("MEDIA_PLAY_PAUSE")} label="Play/pause">
            <Play size={16} className="-mr-1" />
            <Pause size={16} />
          </RoundButton>
          <RoundButton onClick={() => key("MEDIA_FAST_FORWARD")} label="Fast forward">
            <FastForward size={18} />
          </RoundButton>
        </div>
      </div>

      <SheetSection title="Apps">
        <div className="grid grid-cols-4 gap-2">
          {TV_APPS.map((a) => (
            <button
              key={a.name}
              onClick={() => launch(a.activity)}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-chip py-3 text-[11px] font-semibold text-text active:scale-95"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold text-white"
                style={{ background: a.color }}
              >
                {a.name.charAt(0)}
              </span>
              <span className="w-full truncate px-1 text-center">{a.name}</span>
            </button>
          ))}
        </div>
      </SheetSection>
    </Sheet>
  );
}

/**
 * TV card: pick a TV, power, what's on, quick volume and play/pause, and a
 * button for the full remote sheet.
 */
export function TvCard({ index = 0 }: { index?: number }) {
  const { entities } = useHa();
  const tvs = CURATED_TVS.filter((t) => entities[t.remote]);
  const [selected, setSelected] = useState(tvs[0]?.key);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const tv = tvs.find((t) => t.key === selected) ?? tvs[0];
  const { on, available, app, playing, key, power } = useTv(tv ?? CURATED_TVS[0]);

  if (!tv) return null;

  return (
    <div
      className="glass rise flex flex-col gap-4 rounded-[26px] p-5"
      style={{ background: `color-mix(in srgb, ${TINT} var(--tint-strength), var(--glass))`, animationDelay: `${300 + index * 50}ms` }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: "var(--chip-off)", color: ACCENT }}
        >
          <Tv size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[19px] font-semibold tracking-[-0.3px] text-text">{tv.name}</div>
          <div className="truncate text-[13px] text-text-dim">
            {!available ? "Unreachable" : on ? (app ? `On · ${app}` : "On") : "Off"}
          </div>
        </div>
        <button
          onClick={power}
          aria-label={on ? "Turn off" : "Turn on"}
          className="flex h-11 w-11 items-center justify-center rounded-full transition-colors active:scale-90"
          style={on ? { background: ACCENT, color: "#fff", boxShadow: `0 6px 16px -6px ${ACCENT}` } : { background: "var(--chip-off)", color: "var(--color-text)" }}
        >
          <Power size={18} />
        </button>
      </div>

      {tvs.length > 1 && (
        <div className="flex gap-1 rounded-full p-1" style={{ background: "var(--chip-off)" }}>
          {tvs.map((t) => (
            <button
              key={t.key}
              onClick={() => setSelected(t.key)}
              className="min-w-0 flex-1 truncate rounded-full px-1 py-1.5 text-xs font-semibold transition-colors"
              style={t.key === tv.key ? { background: ACCENT, color: "#fff" } : { color: "var(--color-text-dim)" }}
            >
              {t.chip ?? t.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => key("VOLUME_DOWN")}
          aria-label="Volume down"
          className="flex h-10 w-10 items-center justify-center rounded-full text-text active:scale-90"
          style={{ background: "var(--chip-off)" }}
        >
          <Volume1 size={17} />
        </button>
        <button
          onClick={() => key("VOLUME_UP")}
          aria-label="Volume up"
          className="flex h-10 w-10 items-center justify-center rounded-full text-text active:scale-90"
          style={{ background: "var(--chip-off)" }}
        >
          <Volume2 size={17} />
        </button>
        <button
          onClick={() => key("MEDIA_PLAY_PAUSE")}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-10 w-10 items-center justify-center rounded-full text-text active:scale-90"
          style={{ background: "var(--chip-off)" }}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button
          onClick={() => setRemoteOpen(true)}
          className="ml-auto flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white active:scale-95"
          style={{ background: ACCENT }}
        >
          <Gamepad2 size={16} /> Remote
        </button>
      </div>

      {remoteOpen && <RemoteSheet tv={tv} onClose={() => setRemoteOpen(false)} />}
    </div>
  );
}
