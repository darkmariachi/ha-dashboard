import { Lightbulb, Sparkles } from "lucide-react";
import { CURATED_ROOMS } from "./curatedHome";

export interface InsightLight {
  entityId: string;
  label: string;
  room: string;
}

/**
 * Lights tracked on the Insights tab: every light toggle on the Home
 * screen's room cards (the Lightbulb / Sparkles ones, so fans and the bar
 * fridge stay out), each room's Hue group, plus lights that aren't on the
 * room grid. On-time is worked out from HA's recorder history.
 */
export const INSIGHT_LIGHTS: InsightLight[] = [
  ...CURATED_ROOMS.flatMap((room) => [
    ...(room.lights ? [{ entityId: room.lights, label: "Hue lights", room: room.name }] : []),
    ...room.toggles
      .filter((t) => t.icon === Lightbulb || t.icon === Sparkles)
      .map((t) => ({ entityId: t.entityId, label: t.label, room: room.name })),
  ]),
  { entityId: "switch.andy_s_bedroom_light", label: "Light", room: "Andy's Room" },
];

/** How often the Insights tab refetches history. */
export const INSIGHTS_REFRESH_MS = 5 * 60 * 1000;
