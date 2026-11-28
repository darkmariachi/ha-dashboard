import { CardLayout } from "../layout/CardLayout";
import clsx from "clsx";
import { CURATED_WEATHER_ENTITY } from "../../config/curatedHome";
import { GAMING } from "../../config/gaming";
import { useHa } from "../../ha/HaProvider";
import { isNightFor } from "../../lib/weatherTheme";
import { GamingCard } from "../devices/GamingCard";
import { WeatherBackground } from "../home/WeatherBackground";
import { FaceScanCard } from "./FaceScanCard";
import { LightsInsightCard } from "./LightsInsightCard";
import { PresenceInsightCard } from "./PresenceInsightCard";

/** The Insights cards in one column — the phone's Insights tab. */
export function InsightsColumn() {
  return (
    <CardLayout
      layoutKey="phone.insights"
      className="flex flex-col gap-3"
      items={[
        { id: "facescan", label: "Face scan", node: <FaceScanCard /> },
        { id: "presence", label: "Who was home", node: <PresenceInsightCard index={1} /> },
        { id: "lights", label: "Lights", node: <LightsInsightCard index={2} /> },
        { id: "gaming", label: `${GAMING.kid}'s gaming`, node: <GamingCard index={3} /> },
      ]}
    />
  );
}

/**
 * The wall tablet's Insights page at /insights (in the sidebar): patterns
 * pulled from HA's recorder history — who was home when, how long the
 * lights stay on — plus Andy's console time. Same weather backdrop and
 * night mode as the Home screen.
 */
export function InsightsPage() {
  const { entities } = useHa();
  const weather = entities[CURATED_WEATHER_ENTITY];
  const isNight = isNightFor(entities["sun.sun"]?.state);

  return (
    <div className={clsx("relative flex h-full flex-col", isNight && "home-night")} data-sheet-root>
      <WeatherBackground condition={weather?.state} isNight={isNight} />

      {/* No z-index: see PhoneScreen. */}
      <div className="relative h-full overflow-y-auto px-7 pb-10 pt-20">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
          <h1 className="rise hero-shadow text-[34px] font-semibold tracking-[-0.5px] text-white">Insights</h1>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex flex-col gap-4 lg:flex-1">
              <PresenceInsightCard />
              <GamingCard index={2} />
            </div>
            <div className="flex flex-col gap-4 lg:flex-1">
              <FaceScanCard index={3} />
              <LightsInsightCard index={1} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
