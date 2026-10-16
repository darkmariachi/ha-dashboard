/**
 * Andy's consoles, for the gaming card on the Insights tab.
 *
 * PS5: the PlayStation Network integration, on the PSN account he plays on
 * (it's under Rodolfo's name, "rufongora"). Its media player is off / on
 * (online on the console) / playing (in a game); on + playing both count as
 * screen time. The today/week totals are HA history_stats sensors in
 * configuration.yaml on skylab; the 7-day chart is worked out from history.
 *
 * Switch: the Nintendo Switch parental controls integration ("rudy's
 * Switch 2"). It reports the whole console's screen time used today (it
 * resets at midnight), so daily totals are the day's highest reading.
 */
export const GAMING = {
  kid: "Andy",
  ps5: {
    player: "media_player.playstation_5",
    today: "sensor.andy_ps5_today",
    week: "sensor.andy_ps5_this_week",
    lastOnline: "sensor.living_room_rufongora_psn_account_last_online",
    /** Media-player states that count as playing time. */
    activeStates: ["on", "playing"],
  },
  nintendo: {
    /** Minutes played today; also used to find the device for bonus time. */
    usedToday: "sensor.rudy_s_switch_2_used_screen_time",
    remaining: "sensor.rudy_s_switch_2_screen_time_remaining",
    /** Today's limit in minutes; -1 = no limit. */
    limit: "number.rudy_s_switch_2_max_screentime_today",
    /** Nintendo's "suspend software when the limit is reached" setting. */
    stopAtLimit: "switch.rudy_s_switch_2_suspend_software",
    /** Limit presets offered on the card, in minutes (-1 = none). */
    limitPresets: [-1, 60, 120, 180],
    /** Counts as "playing now" if used time went up this recently. */
    playingWindowMinutes: 6,
  },
};
