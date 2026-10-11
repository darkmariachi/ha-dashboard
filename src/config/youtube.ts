/**
 * The kids' YouTube time, for the YouTube card on the Devices tab.
 *
 * YouTube has no API for watch time (and none at all for YouTube Kids
 * profiles), so this is measured from the TVs: the Android TV Remote
 * integration reports which app is in the foreground, and the card adds up
 * the time each TV spent on with a YouTube app open. That's every
 * media player from `platform` — the Shields and the living room TV —
 * as one household total, since the TVs are shared between Andy and Dany.
 *
 * It's foreground time, not playback time: a video left paused with the TV
 * on still counts. Nothing is stored in HA for this; totals are worked out
 * from the recorder's history, so they reach back as far as it keeps (10
 * days by default).
 */
export const YOUTUBE = {
  title: "Kids' YouTube",
  platform: "androidtv_remote",
  /** Android TV package names (the player's app_id) that count. */
  apps: {
    "com.google.android.youtube.tvkids": "kids",
    "com.google.android.youtube.tv": "youtube",
  } as Record<string, "kids" | "youtube">,
  /** Media-player states where the TV isn't showing anything. */
  offStates: ["off", "standby", "unavailable", "unknown"],
};
