import { Fan, SunDim } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { CuratedRoom } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { roomColorFor, tintedGlass } from "../../lib/roomPalette";
import { slugifyAreaName } from "../../lib/slug";
import { ROOM_ILLUSTRATIONS } from "../illustrations/RoomIllustrations";
import { IconToggleButton } from "./IconToggleButton";
import { LightSheet } from "./LightSheet";

export function RoomCard({
  room,
  index,
  titleLink = true,
}: {
  room: CuratedRoom;
  index: number;
  /** Link the room's name to its All Areas page. Off on the TV, where that
   * page isn't built for the remote. */
  titleLink?: boolean;
}) {
  const { entities, callService } = useHa();
  const [lightsOpen, setLightsOpen] = useState(false);
  const color = roomColorFor(index);
  const hue = room.lights ? entities[room.lights] : undefined;
  const hueOn = hue?.state === "on";
  const hueBrightness = hueOn
    ? Math.round(((hue!.attributes.brightness as number | undefined) ?? 0) / 2.55)
    : 0;
  const Illustration = ROOM_ILLUSTRATIONS[room.illustration];
  const onCount = room.toggles.filter((t) => entities[t.entityId]?.state === "on").length;
  const active = onCount > 0;

  function toggle(entityId: string) {
    callService("switch", "toggle", {}, { entity_id: entityId }).catch(() => {});
  }

  return (
    <div
      className="glass rise relative flex min-h-[168px] items-stretch justify-between gap-3 overflow-hidden rounded-[26px] py-4 pl-5 pr-4"
      style={{
        background: tintedGlass(color),
        animationDelay: `${300 + index * 50}ms`,
        // Lit rooms get an accent-colored edge and halo.
        ...(active && {
          borderColor: `${color.accent}8c`,
          boxShadow: `var(--glass-shadow), 0 0 0 1px ${color.accent}4d, 0 0 34px -6px ${color.accent}8c`,
        }),
      }}
    >
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {titleLink ? (
          <Link
            to={`/area/${slugifyAreaName(room.name)}`}
            className="w-fit text-[19px] font-semibold tracking-[-0.3px] text-text hover:underline"
          >
            {room.name}
          </Link>
        ) : (
          <div className="text-[19px] font-semibold tracking-[-0.3px] text-text">{room.name}</div>
        )}
        <div className="mt-0.5 flex items-center text-[13px] text-text-dim">
          {active ? (
            <>
              <span
                className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full"
                style={{ background: color.accent, boxShadow: `0 0 8px ${color.accent}` }}
              />
              {onCount} on
            </>
          ) : (
            "All off"
          )}
        </div>
        {hue && (
          <button
            onClick={() => {
              navigator.vibrate?.(8);
              setLightsOpen(true);
            }}
            className="mt-2 flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-transform active:scale-95"
            style={
              hueOn
                ? { background: color.accent, color: "#fff", boxShadow: `0 4px 12px -4px ${color.accent}` }
                : { background: "var(--chip-off)", color: color.accent }
            }
          >
            <SunDim size={14} />
            {hueOn ? `Hue · ${hueBrightness}%` : "Hue off"}
          </button>
        )}
      </div>

      <Illustration
        size={104}
        strokeWidth={1.1}
        aria-hidden
        className={clsx(
          "pointer-events-none absolute -bottom-3.5 left-3.5 transition-[opacity,transform] duration-500",
          active ? "-translate-y-1 opacity-40" : "opacity-[0.22]",
        )}
        style={{ color: color.accent }}
      />

      <div className="relative z-10 flex w-[184px] flex-wrap content-start justify-end gap-2">
        {room.toggles.map((toggle_) => {
          const state = entities[toggle_.entityId]?.state;
          const unavailable = state === undefined || state === "unavailable";
          return (
            <IconToggleButton
              key={toggle_.entityId}
              icon={toggle_.icon}
              label={toggle_.label}
              on={state === "on"}
              accent={unavailable ? "#b5b0a3" : color.accent}
              spinWhenOn={toggle_.icon === Fan}
              onClick={() => !unavailable && toggle(toggle_.entityId)}
            />
          );
        })}
      </div>

      {lightsOpen && room.lights && (
        <LightSheet
          groupId={room.lights}
          roomName={room.name}
          accent={color.accent}
          onClose={() => setLightsOpen(false)}
        />
      )}
    </div>
  );
}
