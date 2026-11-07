import clsx from "clsx";
import { CURATED_WEATHER_ENTITY } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { isNightFor } from "../../lib/weatherTheme";
import { WeatherBackground } from "../home/WeatherBackground";
import { VisitorsPanel } from "./VisitorsPanel";

/**
 * The tablet's Visitors page at /visitors (in the menu): the same panel as
 * the phone's Visitors tab — who's over, visit history, naming new devices
 * and faces — in the Home screen's backdrop and night mode.
 */
export function VisitorsPage() {
  const { entities } = useHa();
  const weather = entities[CURATED_WEATHER_ENTITY];
  const isNight = isNightFor(entities["sun.sun"]?.state);

  return (
    <div className={clsx("relative flex h-full flex-col", isNight && "home-night")} data-sheet-root>
      <WeatherBackground condition={weather?.state} isNight={isNight} />

      {/* No z-index: see PhoneScreen. */}
      <div className="relative h-full overflow-y-auto px-7 pb-10 pt-20">
        <div className="mx-auto flex max-w-[760px] flex-col">
          <h1 className="rise hero-shadow mb-4 text-[34px] font-semibold tracking-[-0.5px] text-white">Visitors</h1>
          <VisitorsPanel />
        </div>
      </div>
    </div>
  );
}
