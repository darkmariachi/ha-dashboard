import { Lightbulb, SunDim, Tv, type LucideIcon } from "lucide-react";
import { CURATED_ROOMS, CURATED_TVS, HOUSEHOLD_PEOPLE, ON_NOW_IGNORE } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { ON_STATES } from "../../lib/entityHelpers";
import { Sheet, SheetSection } from "./Sheet";

export interface OnItem {
  entityId: string;
  label: string;
  /** Heading it's listed under: the curated room, "TVs", or its HA area. */
  room: string;
  icon: LucideIcon;
  /** In an outdoor room — left alone by "turn off all", like "We're leaving". */
  outdoor: boolean;
  detail?: string;
}

function brightness(attrs: Record<string, unknown>) {
  const b = attrs.brightness as number | undefined;
  return b === undefined ? undefined : `${Math.round(b / 2.55)}%`;
}

/**
 * Everything that's on right now and could be turned off: the curated rooms'
 * toggles and Hue groups, the TVs, and any other light HA reports as on
 * (lights in rooms that aren't on the Home screen, like the garage).
 */
export function useOnNow() {
  const { entities, entitiesWithArea } = useHa();
  const ignore = new Set(ON_NOW_IGNORE);
  const seen = new Set<string>();
  const items: OnItem[] = [];
  function add(item: OnItem) {
    if (ignore.has(item.entityId) || seen.has(item.entityId)) return;
    seen.add(item.entityId);
    items.push(item);
  }

  // Areas whose bulbs are already counted through their Hue group.
  const grouped = new Set<string>();

  for (const room of CURATED_ROOMS) {
    const outdoor = !!room.external;
    if (room.lights) {
      const group = entities[room.lights];
      const area = entitiesWithArea[room.lights]?.areaName;
      if (area) grouped.add(area);
      if (group?.state === "on") {
        add({
          entityId: room.lights,
          label: "Hue lights",
          room: room.name,
          icon: SunDim,
          outdoor,
          detail: brightness(group.attributes),
        });
      }
    }
    for (const t of room.toggles) {
      if (entities[t.entityId]?.state === "on") {
        add({ entityId: t.entityId, label: t.label, room: room.name, icon: t.icon, outdoor });
      }
    }
  }

  for (const tv of CURATED_TVS) {
    if (ON_STATES.has(entities[tv.player]?.state ?? "")) {
      add({ entityId: tv.player, label: tv.name, room: "TVs", icon: Tv, outdoor: false });
    }
  }

  // Hue zones span rooms, so they'd count the same bulbs twice.
  const others = Object.values(entitiesWithArea)
    .filter((e) => e.domain === "light" && e.entity.state === "on" && e.entity.attributes.hue_type !== "zone")
    .sort((a, b) => (a.areaName ?? "~").localeCompare(b.areaName ?? "~") || a.friendlyName.localeCompare(b.friendlyName));
  const otherGroups = others.filter((e) => e.entity.attributes.is_hue_group);
  for (const e of otherGroups) if (e.areaName) grouped.add(e.areaName);
  for (const e of [...otherGroups, ...others.filter((o) => !o.entity.attributes.is_hue_group)]) {
    if (!e.entity.attributes.is_hue_group && e.areaName && grouped.has(e.areaName)) continue;
    add({
      entityId: e.entityId,
      label: e.friendlyName,
      room: e.areaName ?? "Elsewhere",
      icon: Lightbulb,
      outdoor: false,
      detail: brightness(e.entity.attributes),
    });
  }

  const people = HOUSEHOLD_PEOPLE.map((id) => entities[id]?.state);
  const away =
    people.length > 0 && people.every((s) => s !== undefined && s !== "home" && s !== "unknown" && s !== "unavailable");

  return { items, indoor: items.filter((i) => !i.outdoor), away };
}

export function OnNowModal({ onClose }: { onClose: () => void }) {
  const { callService } = useHa();
  const { items, indoor, away } = useOnNow();

  function turnOff(ids: string[]) {
    navigator.vibrate?.(10);
    callService("homeassistant", "turn_off", {}, { entity_id: ids }).catch(() => {});
  }

  const rooms = new Map<string, OnItem[]>();
  for (const item of items) rooms.set(item.room, [...(rooms.get(item.room) ?? []), item]);
  const outdoorCount = items.length - indoor.length;

  return (
    <Sheet
      title="On right now"
      subtitle={
        items.length === 0 ? "Everything's off" : `${items.length} on${away ? " · nobody's home" : ""}`
      }
      onClose={onClose}
    >
      {items.length === 0 && <div className="text-sm text-text-dim">Nothing to turn off.</div>}

      {[...rooms].map(([room, list]) => (
        <SheetSection key={room} title={room}>
          <div className="flex flex-col gap-2">
            {list.map((item) => (
              <div key={item.entityId} className="flex items-center gap-3 rounded-2xl bg-chip px-3.5 py-2.5">
                <item.icon size={18} className="shrink-0 text-text-dim" />
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                  {item.label}
                  {item.detail && <span className="font-normal text-text-dim"> · {item.detail}</span>}
                </div>
                <button
                  onClick={() => turnOff([item.entityId])}
                  aria-label={`Turn off ${item.label}`}
                  className="shrink-0 rounded-full bg-surface px-3.5 py-1.5 text-xs font-semibold text-text active:scale-95"
                >
                  Turn off
                </button>
              </div>
            ))}
          </div>
        </SheetSection>
      ))}

      {indoor.length > 1 && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => turnOff(indoor.map((i) => i.entityId))}
            className="rounded-full py-3 text-sm font-semibold text-white active:scale-95"
            style={{ background: "#4f79c9" }}
          >
            {outdoorCount > 0 ? `Turn off the ${indoor.length} indoors` : `Turn off all ${indoor.length}`}
          </button>
          {outdoorCount > 0 && (
            <p className="text-center text-xs text-text-dim">Driveway and backyard stay as they are.</p>
          )}
        </div>
      )}
    </Sheet>
  );
}
