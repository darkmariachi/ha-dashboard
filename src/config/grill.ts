/** The Kamado Joe Konnected Joe, via the masterbuilt_gravity custom
 * integration (cloud-polled every 30 s), plus the auto-hold helpers that
 * the "Grill: drop to holding temp" automation reads. */
const G = "joe_biden";

export const GRILL = {
  name: "Kamado Joe",
  grillTemp: `sensor.${G}_grill_temperature`,
  target: `number.${G}_grill_target`,
  fan: `sensor.${G}_fan_speed`,
  power: `binary_sensor.${G}_power`,
  heating: `binary_sensor.${G}_heating`,
  atTemp: `binary_sensor.${G}_at_temperature`,
  lid: `binary_sensor.${G}_lid`,
  stale: `binary_sensor.${G}_stale_data`,
  problem: `binary_sensor.${G}_problem`,
  error: `sensor.${G}_error`,
  cookStart: `sensor.${G}_cook_start`,
  probes: [1, 2, 3].map((n) => ({
    name: `Probe ${n}`,
    temp: `sensor.${G}_probe_${n}_temperature`,
    target: `number.${G}_probe_${n}_target`,
  })),
  hold: {
    armed: "input_boolean.grill_auto_hold",
    doneTemp: "input_number.grill_done_temp",
    holdTemp: "input_number.grill_hold_temp",
  },
};
