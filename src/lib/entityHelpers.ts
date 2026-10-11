import type { CuratedCamera } from "../config/curatedHome";
import type { EntityWithArea } from "../ha/types";

/** States that mean "this entity isn't giving us anything useful right now". */
const DEAD_STATES = new Set(["unavailable", "unknown"]);

export function isDead(ent: EntityWithArea): boolean {
  // Scenes have no real on/off state in HA — they report "unknown" permanently
  // until activated, which is normal, not a sign anything is wrong.
  if (ent.domain === "scene") return ent.entity.state === "unavailable";
  return DEAD_STATES.has(ent.entity.state);
}

export function isOn(ent: EntityWithArea): boolean {
  return ["on", "playing", "home", "open", "unlocked", "cleaning"].includes(
    ent.entity.state,
  );
}

/** Domains we don't currently render a card for and should skip entirely. */
const UNHANDLED_DOMAINS = new Set([
  "device_tracker",
  "person",
  "zone",
  "automation",
  "script",
  "update",
  "button",
  "number",
  "select",
  "input_boolean",
  "input_select",
  "input_number",
  "tag",
  "todo",
  "calendar",
  "sun",
  "weather",
]);

export function isRenderable(ent: EntityWithArea): boolean {
  return !UNHANDLED_DOMAINS.has(ent.domain);
}

export function formatState(ent: EntityWithArea): string {
  const { entity } = ent;
  const unit = entity.attributes.unit_of_measurement as string | undefined;
  if (unit) return `${entity.state}${unit}`;
  return entity.state.replace(/_/g, " ");
}

/** Rough device-class -> human label, used for sensor/binary_sensor subtitles. */
export function deviceClassLabel(ent: EntityWithArea): string | null {
  const dc = ent.entity.attributes.device_class as string | undefined;
  if (!dc) return null;
  return dc.replace(/_/g, " ");
}

export function sortByName(a: EntityWithArea, b: EntityWithArea): number {
  return a.friendlyName.localeCompare(b.friendlyName);
}

/** Resolves a curated camera entry to a real entity, using the curated label
 * instead of whatever raw name HA reports, and falling back to a synthetic
 * "unavailable" entity if it isn't found yet (e.g. camera not yet set up) so
 * the tile still renders cleanly. */
export function resolveCuratedCamera(
  entitiesWithArea: Record<string, EntityWithArea>,
  cam: CuratedCamera,
): EntityWithArea {
  const found = entitiesWithArea[cam.entityId];
  if (found) return { ...found, friendlyName: cam.label };
  return {
    entity: {
      entity_id: cam.entityId,
      state: "unavailable",
      attributes: {},
      context: { id: "", parent_id: null, user_id: null },
      last_changed: "",
      last_updated: "",
    },
    entityId: cam.entityId,
    domain: "camera",
    areaId: null,
    areaName: null,
    deviceId: null,
    platform: null,
    friendlyName: cam.label,
  };
}
