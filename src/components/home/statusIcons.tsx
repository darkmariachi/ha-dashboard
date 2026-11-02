import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Flame,
  Moon,
  Snowflake,
  Sun,
  Thermometer,
  Wind,
  type LucideIcon,
} from "lucide-react";

const CONDITION_LABELS: Record<string, string> = {
  "clear-night": "Clear night",
  cloudy: "Cloudy",
  exceptional: "Exceptional",
  fog: "Foggy",
  hail: "Hail",
  lightning: "Thunderstorms",
  "lightning-rainy": "Thunderstorms",
  partlycloudy: "Partly cloudy",
  pouring: "Pouring",
  rainy: "Rainy",
  snowy: "Snowy",
  "snowy-rainy": "Sleet",
  sunny: "Sunny",
  windy: "Windy",
  "windy-variant": "Windy",
};

/** Human-readable label for a Home Assistant weather condition string. */
export function weatherLabel(condition: string | undefined): string {
  if (!condition) return "—";
  return CONDITION_LABELS[condition] ?? condition.replace(/-/g, " ");
}

/** Maps a Home Assistant weather condition string to an icon. */
export function weatherIcon(condition: string | undefined): LucideIcon {
  switch (condition) {
    case "sunny":
      return Sun;
    case "clear-night":
      return Moon;
    case "partlycloudy":
      return CloudSun;
    case "cloudy":
      return Cloud;
    case "rainy":
    case "pouring":
      return CloudRain;
    case "snowy":
    case "snowy-rainy":
      return CloudSnow;
    case "lightning":
    case "lightning-rainy":
      return CloudLightning;
    case "fog":
      return CloudFog;
    case "windy":
    case "windy-variant":
      return Wind;
    default:
      return Cloud;
  }
}

/** W readings of 1000+ read better as kW on a glance-at display. */
export function powerParts(state: string, unit: string | undefined) {
  const n = parseFloat(state);
  if (!Number.isFinite(n)) return null;
  if (unit === "W" && Math.abs(n) >= 1000) return { value: n / 1000, decimals: 2, unit: "kW" };
  return { value: n, decimals: unit === "W" ? 0 : 2, unit: unit ?? "" };
}

export const HVAC_STYLES: Record<string, { icon: LucideIcon; bg: string; fg: string }> = {
  cool: { icon: Snowflake, bg: "#dceafe", fg: "#2f5fae" },
  heat: { icon: Flame, bg: "#ffe6d2", fg: "#b9621d" },
  heat_cool: { icon: Thermometer, bg: "#e9e2fb", fg: "#6a4fc0" },
  auto: { icon: Thermometer, bg: "#e9e2fb", fg: "#6a4fc0" },
  fan_only: { icon: Wind, bg: "#dcf5e8", fg: "#2b7f5a" },
  dry: { icon: Wind, bg: "#fff1d6", fg: "#9a6a12" },
};
