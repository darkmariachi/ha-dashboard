import {
  DoorOpen,
  Fan,
  Lightbulb,
  Moon,
  PartyPopper,
  Refrigerator,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type RoomIllustrationKey =
  | "kitchen"
  | "livingRoom"
  | "office"
  | "bedroom"
  | "driveway"
  | "diningRoom"
  | "backyard"
  | "attic";

export interface CuratedToggle {
  entityId: string;
  label: string;
  icon: LucideIcon;
}

export interface CuratedRoom {
  key: string;
  name: string;
  illustration: RoomIllustrationKey;
  toggles: CuratedToggle[];
  /** The room's Hue group light (light.<room>, is_hue_group) — adds a "Hue"
   * chip that opens brightness, colors, scenes and per-bulb control. */
  lights?: string;
  /** Outdoor/exterior room — excluded from "indoor" quick actions like
   * "We're leaving". */
  external?: boolean;
}

export interface CuratedCamera {
  entityId: string;
  label: string;
  /** Shown in the vertical sidebar column next to the room grid, instead of
   * the "Cameras" wall further down the page. */
  sidebar?: boolean;
}

/**
 * The real rooms + entities Rodolfo listed from his current Lovelace config.
 * This ships as the default "Home" screen content instead of an
 * auto-generated everything-by-domain view — curated on purpose, since the
 * whole point of this screen is "the entities I actually reach for," not
 * a complete inventory (that's what the room pages via the sidebar are for).
 */
export const CURATED_ROOMS: CuratedRoom[] = [
  {
    key: "kitchen",
    name: "Kitchen",
    illustration: "kitchen",
    toggles: [
      { entityId: "switch.kitchen_hang_lights_switch_2", label: "Lights", icon: Lightbulb },
      { entityId: "switch.kitchen_hang_switch", label: "Accent", icon: Lightbulb },
    ],
  },
  {
    key: "living_room",
    name: "Living Room",
    illustration: "livingRoom",
    lights: "light.living_room",
    toggles: [
      { entityId: "switch.living_room_candelabra", label: "Candelabra", icon: Sparkles },
      { entityId: "switch.living_room_entrance_light", label: "Entrance", icon: Lightbulb },
      { entityId: "switch.living_room_flood", label: "Flood", icon: Lightbulb },
      { entityId: "switch.hallway_lights_switch", label: "Hallway", icon: Lightbulb },
    ],
  },
  {
    key: "office",
    name: "Office",
    illustration: "office",
    lights: "light.office",
    toggles: [
      { entityId: "switch.office_fan", label: "Fan", icon: Fan },
      { entityId: "switch.office_lights", label: "Lights", icon: Lightbulb },
    ],
  },
  {
    key: "bedroom",
    name: "Bedroom",
    illustration: "bedroom",
    lights: "light.bedroom",
    toggles: [
      { entityId: "switch.bedroom_fan_lights_switch", label: "Fan Light", icon: Lightbulb },
      { entityId: "switch.bedroom_fan_switch", label: "Fan", icon: Fan },
      { entityId: "switch.bedroom_flood_light_switch", label: "Flood", icon: Lightbulb },
    ],
  },
  {
    key: "driveway",
    name: "Driveway",
    illustration: "driveway",
    lights: "light.driveway",
    external: true,
    toggles: [
      { entityId: "switch.main_entrance_lights_switch", label: "Entrance", icon: Lightbulb },
      { entityId: "light.permanent_lights_pro", label: "Permanent", icon: Sparkles },
      { entityId: "light.rgbic_path_lights", label: "Path", icon: Lightbulb },
    ],
  },
  {
    key: "dining_room",
    name: "Dining Room",
    illustration: "diningRoom",
    toggles: [{ entityId: "switch.dinning_room_light", label: "Lights", icon: Sparkles }],
  },
  {
    key: "backyard",
    name: "Backyard",
    illustration: "backyard",
    lights: "light.east_backyard",
    external: true,
    toggles: [
      { entityId: "switch.backyard_door_light", label: "Door Light", icon: Lightbulb },
      { entityId: "light.outdoor_deck_lights", label: "Deck", icon: Lightbulb },
      {
        entityId: "switch.tp_link_power_strip_8772_bar_lights",
        label: "Bar Lights",
        icon: Sparkles,
      },
      {
        entityId: "switch.tp_link_power_strip_8772_mini_fridge",
        label: "Bar Fridge",
        icon: Refrigerator,
      },
    ],
  },
  {
    key: "attic",
    name: "Attic",
    illustration: "attic",
    toggles: [
      { entityId: "switch.attic_light", label: "Lights", icon: Lightbulb },
      { entityId: "light.strip_light", label: "Strip", icon: Sparkles },
      { entityId: "light.cob_strip_light", label: "COB", icon: Sparkles },
      { entityId: "light.attic_gaming_pixel_light", label: "Pixel", icon: Sparkles },
    ],
  },
];

export const CURATED_CAMERAS: CuratedCamera[] = [
  { entityId: "camera.driveway_medium", label: "Driveway", sidebar: true },
  { entityId: "camera.g4_doorbell_pro_medium", label: "Front Doorbell", sidebar: true },
  { entityId: "camera.backyard_medium_resolution_channel", label: "Backyard", sidebar: true },
  { entityId: "camera.backyard_east_medium_resolution_channel", label: "Backyard East" },
  { entityId: "camera.backyard_west_medium_resolution_channel", label: "Backyard West" },
  { entityId: "camera.g3_flex_high_4", label: "Flex Cam" },
];

export const CURATED_CLIMATE_ENTITY = "climate.entryway";

/** The Rachio controller. Zones and schedules are switches (on = running). */
export const CURATED_SPRINKLERS = {
  zones: [
    { entityId: "switch.jardin_frente", name: "Jardín frente" },
    { entityId: "switch.arbustos_frente", name: "Arbustos frente" },
    { entityId: "switch.pasillo", name: "Pasillo" },
    { entityId: "switch.zone_4", name: "Zone 4" },
  ],
  schedules: [
    { entityId: "switch.regar_schedule", name: "Regar" },
    { entityId: "switch.regar_2_schedule", name: "Regar 2" },
    { entityId: "switch.pasto_grow_schedule", name: "Pasto grow" },
    { entityId: "switch.pasto_grow_night_schedule", name: "Pasto grow night" },
    { entityId: "switch.dos_dias_a_la_semana_schedule", name: "Todos los días" },
  ],
  /** Turning it on pauses all watering for 24 hours (Rachio's own delay). */
  rainDelay: "switch.rachio_c2a930_rain_delay",
  standby: "switch.rachio_c2a930_in_standby_mode",
  rainSensor: "binary_sensor.rachio_c2a930_rain_sensor",
  /** Minutes offered for a manual zone run. */
  runMinutes: [5, 10, 15],
};

export interface CuratedTv {
  key: string;
  name: string;
  /** androidtv_remote entities: the remote sends keys and launches apps,
   * the media player reports what's on. Power and volume reach the TV
   * panel itself over HDMI-CEC. */
  remote: string;
  player: string;
}

export const CURATED_TVS: CuratedTv[] = [
  {
    key: "living_room",
    name: "Living room TV",
    remote: "remote.living_room_living_room_tv_os",
    player: "media_player.living_room_living_room_tv_os",
  },
  {
    key: "andy",
    name: "Andy's Shield",
    remote: "remote.andy_s_room",
    player: "media_player.andys_shield",
  },
];

/** App shortcuts on the TV remote, launched with remote.turn_on's
 * activity. market://launch opens the app by package name (or its Play
 * Store page if it isn't installed on that TV). */
export const TV_APPS: { name: string; activity: string; color: string }[] = [
  { name: "YouTube", activity: "market://launch?id=com.google.android.youtube.tv", color: "#ff0033" },
  { name: "Netflix", activity: "market://launch?id=com.netflix.ninja", color: "#e50914" },
  { name: "Plex", activity: "market://launch?id=com.plexapp.android", color: "#e5a00d" },
  { name: "Jellyfin", activity: "market://launch?id=org.jellyfin.androidtv", color: "#7d4fc6" },
  { name: "Spotify", activity: "market://launch?id=com.spotify.tv.android", color: "#1db954" },
  { name: "Disney+", activity: "market://launch?id=com.disney.disneyplus", color: "#113ccf" },
  { name: "Prime Video", activity: "market://launch?id=com.amazon.amazonvideo.livingroom", color: "#00a8e1" },
  { name: "Max", activity: "market://launch?id=com.wbd.stream", color: "#002be7" },
];

/**
 * The Roborock. `prefix` is the shared part of all its entity IDs
 * (vacuum.<prefix>, sensor.<prefix>_battery, ...), so the card can find the
 * battery, map, dock tanks and so on without listing each one.
 */
export const CURATED_VACUUM = {
  name: "Doña Alejandra",
  prefix: "dona_alejandra_2_0",
};

/** Home's Sense energy monitor entities, shown in the status bar. */
export const CURATED_ENERGY = {
  consumption: "sensor.sense_1000001241_energy",
  production: "sensor.sense_1000001241_production",
};

export const CURATED_WEATHER_ENTITY = "weather.forecast_home";

/** Who the Home screen greets — it's a shared wall tablet, so the
 * household rather than one person. */
export const HOUSEHOLD_NAME = "Góngora family";

/**
 * Who's-home avatars on the Home screens. HA's person entities combine each
 * person's trackers — their phone's UniFi Wi-Fi tracker (home the moment it
 * joins the network) plus the Companion app's GPS when away — so the
 * dashboard just reads the person, not individual devices.
 */
export const HOUSEHOLD_PEOPLE = ["person.rodolfo", "person.priscilla"];

export interface CuratedDoorSensor {
  entityId: string;
  label: string;
}

/**
 * Door/opening binary_sensors watched by DoorAlertMonitor — "on" = open.
 *
 * binary_sensor.back_door_sensor temporarily removed 2026-08-26 — reporting
 * buggy readings, pending a physical fix. Re-add once fixed.
 */
export const CURATED_DOOR_SENSORS: CuratedDoorSensor[] = [
  { entityId: "binary_sensor.front_door_sensor", label: "Front Door" },
  { entityId: "binary_sensor.garage_door_sensor", label: "Garage Door" },
  { entityId: "binary_sensor.print_room_garage_door", label: "Print Room Garage Door" },
];

/** How long a door can stay open before DoorAlertMonitor fires. */
export const DOOR_ALERT_THRESHOLD_MS = 2 * 60 * 1000;

/** The living room TV itself (androidtv_remote integration) — used to power
 * it on before casting, since the Spotcast entity below can't do that. */
export const CURATED_LIVING_ROOM_TV = "media_player.living_room_living_room_tv_os";

/**
 * Cast target for the Spotify quick-play card, via Spotcast's
 * `spotcast.play_media` service (`data.media_player.entity_id`). This is the
 * Spotcast-created entity for the living room TV's Spotify Connect session
 * (the TV's own `androidtv_remote` entity doesn't work — Spotcast only
 * defers to an existing entity for Chromecast/`cast`-integration devices).
 */
export const CURATED_SPOTIFY_TARGET = "media_player.living_room_tv_1248686237_spotcast";

/**
 * Entities the phone's "On right now" tile never counts — things that are
 * meant to stay on (decorative LEDs, ...). It otherwise lists every room
 * toggle, Hue group and TV above that's on, plus any other light HA reports
 * as on.
 */
export const ON_NOW_IGNORE: string[] = [];

/** Left alone by the bulk "turn everything off"s ("We're leaving", the On
 * right now sheet's turn-off-all) — still listed and individually
 * switchable. */
export const ALL_OFF_KEEP: string[] = ["light.office"];

/** Indoor lights that aren't on the Home screen's room grid but should still
 * go off with everything else. */
export const ALL_OFF_EXTRA: { entityId: string; label: string; room: string }[] = [
  { entityId: "switch.andy_s_bedroom_light", label: "Light", room: "Andy's Room" },
];

export interface QuickAction {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Whether pressing it turns its entities on or off. */
  action: "turn_on" | "turn_off";
  entityIds: string[];
  /** Human-readable summary shown in the confirmation toast on tap. */
  description: string;
}

function toggleIdsOf(key: string): string[] {
  return CURATED_ROOMS.find((r) => r.key === key)?.toggles.map((t) => t.entityId) ?? [];
}

/**
 * Indoor TVs — used by both "We're leaving" and "Good night". Still missing
 * the master bedroom TV as of 2026-08-26; add its entity_id here once known.
 */
const CURATED_INDOOR_TVS: string[] = ["media_player.andys_shield", CURATED_LIVING_ROOM_TV];

/**
 * One-tap scenes shown on the Home screen's Quick Actions card. Each just
 * bulk turn_on/turn_off's a list of entities via the generic `homeassistant`
 * domain service (works across light/switch/fan regardless of which one a
 * given entity actually is).
 */
export const CURATED_QUICK_ACTIONS: QuickAction[] = [
  {
    key: "leaving",
    label: "We're leaving",
    icon: DoorOpen,
    action: "turn_off",
    description:
      "Turning off every indoor light, fan, and TV except the office Hue lights. Driveway and backyard stay as they are.",
    // Every indoor room's lights/fans — driveway and backyard (external:
    // true) are left alone, since you'd still want those on while out.
    entityIds: [
      ...CURATED_ROOMS.filter((r) => !r.external).flatMap((r) => r.toggles.map((t) => t.entityId)),
      // Indoor rooms' Hue groups too, so "everything off" really is.
      ...CURATED_ROOMS.filter((r) => !r.external && r.lights).map((r) => r.lights!),
      ...ALL_OFF_EXTRA.map((e) => e.entityId),
      ...CURATED_INDOOR_TVS,
    ].filter((id) => !ALL_OFF_KEEP.includes(id)),
  },
  {
    key: "party",
    label: "Party",
    icon: PartyPopper,
    action: "turn_on",
    description: "Turning on the backyard door light, bar lights, and fridge.",
    entityIds: toggleIdsOf("backyard"),
  },
  {
    key: "good_night",
    label: "Good night",
    icon: Moon,
    action: "turn_off",
    description: "Turning off the kitchen, living room, and dining room lights, plus the TVs.",
    entityIds: [
      ...toggleIdsOf("kitchen"),
      ...toggleIdsOf("living_room"),
      ...toggleIdsOf("dining_room"),
      ...CURATED_INDOOR_TVS,
    ],
  },
];
