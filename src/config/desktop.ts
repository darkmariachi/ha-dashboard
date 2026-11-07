/**
 * Extra entities only the desktop layout (/desktop) shows — the "more
 * detail" that doesn't fit on the tablet, phone or wall screens. Anything
 * missing in HA just drops out of its panel.
 */

/** Indoor climate sensors charted on the Energy page and summed up in the
 * Overview's Indoor tile (the Nest thermostat's own sensors). */
export const DESKTOP_INDOOR = {
  temperature: "sensor.entryway_temperature",
  humidity: "sensor.entryway_humidity",
};

/** Window contacts (ESPHome / Konnected), "on" = open. Shown next to the
 * doors on the Security page and counted in the Overview's Doors tile. */
export const DESKTOP_WINDOWS: { entityId: string; label: string }[] = [
  { entityId: "binary_sensor.office_window_sensor", label: "Office window" },
  { entityId: "binary_sensor.dinning_room_window_sensor", label: "Dining room window" },
  { entityId: "binary_sensor.andys_window_sensor", label: "Andy's window" },
];

/** UniFi Protect alarm manager. */
export const DESKTOP_ALARM = "alarm_control_panel.orion_alarm_manager";

/** Smoke / CO detection from the UniFi Protect cameras. */
export const DESKTOP_SAFETY: { entityId: string; label: string }[] = [
  { entityId: "binary_sensor.g4_doorbell_pro_smoke_alarm_detected", label: "Doorbell smoke" },
  { entityId: "binary_sensor.g4_doorbell_pro_co_alarm_detected", label: "Doorbell CO" },
  { entityId: "binary_sensor.driveway_smoke_alarm_detected", label: "Driveway smoke" },
  { entityId: "binary_sensor.driveway_co_alarm_detected", label: "Driveway CO" },
];

/** Appliance readings in the House health panel. */
export const DESKTOP_APPLIANCES: { entityId: string; label: string; kind: "temp" | "problem" | "value" }[] = [
  { entityId: "sensor.refrigerator_fridge_temperature", label: "Fridge", kind: "temp" },
  { entityId: "sensor.refrigerator_freezer_temperature", label: "Freezer", kind: "temp" },
  { entityId: "binary_sensor.refrigerator_filter_status", label: "Fridge water filter", kind: "problem" },
  { entityId: "sensor.refrigerator_water_filter_usage", label: "Filter used", kind: "value" },
  { entityId: "sensor.range_temperature_measurement", label: "Oven", kind: "temp" },
];

/** Internet, from the UDM's UPnP integration (rates in KiB/s). */
export const DESKTOP_NETWORK = {
  wan: "binary_sensor.unifi_dream_machine_wan_status_2",
  down: "sensor.unifi_dream_machine_kib_s_received_2",
  up: "sensor.unifi_dream_machine_kib_s_sent_2",
  modem: "sensor.cable_internet_state",
};

/** Battery-powered things at or below this % are listed as low. */
export const LOW_BATTERY_PCT = 20;
