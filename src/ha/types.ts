import type { HassEntity } from "home-assistant-js-websocket";

export interface AreaRegistryEntry {
  area_id: string;
  name: string;
  icon?: string | null;
}

export interface DeviceRegistryEntry {
  id: string;
  area_id: string | null;
}

export interface EntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  /** The integration that created it, e.g. "androidtv_remote". */
  platform: string;
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "auth-invalid"
  | "error";

/** A HA entity augmented with the resolved area name it belongs to (if any). */
export interface EntityWithArea {
  entity: HassEntity;
  entityId: string;
  domain: string;
  areaId: string | null;
  areaName: string | null;
  deviceId: string | null;
  platform: string | null;
  friendlyName: string;
}

export interface AreaGroup {
  areaId: string | null;
  name: string;
  entities: EntityWithArea[];
}

/** Domains this dashboard knows how to render a dedicated card for. */
export const SUPPORTED_DOMAINS = [
  "light",
  "switch",
  "climate",
  "media_player",
  "sensor",
  "binary_sensor",
  "vacuum",
  "scene",
  "fan",
  "lock",
  "cover",
  "camera",
] as const;

export type SupportedDomain = (typeof SUPPORTED_DOMAINS)[number];
