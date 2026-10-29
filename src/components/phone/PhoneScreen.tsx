import { Cctv, ChartColumn, Cpu, House, LayoutGrid, Users, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import clsx from "clsx";
import {
  CURATED_CAMERAS,
  CURATED_ROOMS,
  CURATED_WEATHER_ENTITY,
  HOUSEHOLD_NAME,
} from "../../config/curatedHome";
import { CURATED_COMPUTERS } from "../../config/computers";
import { useHa } from "../../ha/HaProvider";
import { resolveCuratedCamera } from "../../lib/entityHelpers";
import { greetingFor } from "../../lib/greeting";
import { useNow } from "../../lib/useNow";
import { isNightFor } from "../../lib/weatherTheme";
import { CameraCard } from "../cards/CameraCard";
import { ActivityFeed } from "../home/ActivityFeed";
import { ComputerCard } from "../devices/ComputerCard";
import { NotificationsCard } from "../devices/NotificationsCard";
import { InsightsColumn } from "../insights/InsightsPage";
import { QuickActionLink } from "./QuickActionLink";
import { ThermostatAwayLink } from "./ThermostatAwayLink";
import { YouTubeCard } from "../devices/YouTubeCard";
import { RoomCard } from "../home/RoomCard";
import { StatusBar } from "../home/StatusBar";
import { SprinklersCard } from "../home/SprinklersCard";
import { TvCard } from "../home/TvCard";
import { VacuumCard } from "../home/VacuumCard";
import { weatherIcon, weatherLabel } from "../home/statusIcons";
import { useWeatherForecast } from "../home/useWeatherForecast";
import { WeatherBackground } from "../home/WeatherBackground";
import { WhoIsHome } from "../home/WhoIsHome";
import { VisitorsPanel } from "../visitors/VisitorsPanel";

/** How often the phone's camera stills refresh (live stream on tap). */
const CAMERA_SNAPSHOT_MS = 10_000;

function WeatherGlyph({ condition, size }: { condition: string | undefined; size: number }) {
  // createElement rather than <Icon />: the icon is looked up per render.
  return createElement(weatherIcon(condition), { size, strokeWidth: 1.5 });
}

function round(v: number | undefined) {
  return v === undefined ? "—" : `${Math.round(v)}°`;
}

/** Compact version of the tablet's HomeHero: greeting, then current
 * weather and the next few hours on one swipeable row. */
function PhoneHeader() {
  const { entities } = useHa();
  const now = useNow(60_000);
  const weather = entities[CURATED_WEATHER_ENTITY];
  const hourly = useWeatherForecast(CURATED_WEATHER_ENTITY, "hourly");
  const daily = useWeatherForecast(CURATED_WEATHER_ENTITY, "daily");
  const temp = weather?.attributes.temperature as number | undefined;
  const today = daily?.[0];
  const nextHours = (hourly ?? [])
    .filter((f) => new Date(f.datetime).getTime() > now.getTime())
    .slice(0, 6);

  return (
    <header className="rise hero-shadow mb-5 text-white">
      <div className="text-[13px] font-medium opacity-85">
        {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </div>
      <h1 className="mt-0.5 text-[26px] font-semibold leading-tight tracking-[-0.5px]">
        {greetingFor(now.getHours())},<br />
        {HOUSEHOLD_NAME}
      </h1>

      <div className="mt-3">
        <WhoIsHome size={36} />
      </div>

      {weather && (
        <div className="mt-4 flex items-center gap-3">
          <WeatherGlyph condition={weather.state} size={40} />
          <div className="text-[48px] font-light leading-none tracking-[-2px]">
            {temp === undefined ? "—" : Math.round(temp)}°
          </div>
          <div className="text-[13px] leading-snug opacity-90">
            <div className="text-[15px] font-semibold">{weatherLabel(weather.state)}</div>
            {today && (
              <div>
                H {round(today.temperature)} · L {round(today.templow)}
              </div>
            )}
          </div>
        </div>
      )}

      {nextHours.length > 0 && (
        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [text-shadow:none]">
          {nextHours.map((f) => (
            <div
              key={f.datetime}
              className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-white/25 bg-white/15 py-2.5 text-xs backdrop-blur-md"
            >
              {new Date(f.datetime).toLocaleTimeString(undefined, { hour: "numeric" })}
              <WeatherGlyph condition={f.condition} size={20} />
              <b className="text-sm font-semibold">{round(f.temperature)}</b>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}

function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="rise hero-shadow mb-4 text-[28px] font-semibold tracking-[-0.5px] text-white">
      {children}
    </h1>
  );
}

function RoomsTab() {
  return (
    <>
      <PageTitle>Rooms</PageTitle>
      <div className="flex flex-col gap-3">
        {CURATED_ROOMS.map((room, i) => (
          <RoomCard key={room.key} room={room} index={i} />
        ))}
        <TvCard index={CURATED_ROOMS.length} />
        <VacuumCard index={CURATED_ROOMS.length + 1} />
        <SprinklersCard index={CURATED_ROOMS.length + 2} />
      </div>
    </>
  );
}

function CamerasTab() {
  const { entitiesWithArea } = useHa();
  return (
    <>
      <PageTitle>Cameras</PageTitle>
      <div className="flex flex-col gap-3">
        {CURATED_CAMERAS.map((cam, i) => (
          <div key={cam.entityId} className="rise" style={{ animationDelay: `${100 + i * 50}ms` }}>
            <CameraCard
              ent={resolveCuratedCamera(entitiesWithArea, cam)}
              bare
              snapshotEveryMs={CAMERA_SNAPSHOT_MS}
            />
          </div>
        ))}
      </div>
      <p className="hero-shadow mt-3 text-center text-xs text-white/75">
        Stills refresh every {CAMERA_SNAPSHOT_MS / 1000}s · tap a camera for live video
      </p>
      <h2 className="hero-shadow mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">Activity</h2>
      <div className="rise" style={{ animationDelay: `${100 + CURATED_CAMERAS.length * 50}ms` }}>
        <ActivityFeed />
      </div>
    </>
  );
}

function DevicesTab() {
  return (
    <>
      <PageTitle>Devices</PageTitle>
      <div className="flex flex-col gap-3">
        <YouTubeCard />
        {CURATED_COMPUTERS.map((c, i) => (
          <ComputerCard key={c.key} computer={c} index={i + 1} />
        ))}
        <NotificationsCard index={CURATED_COMPUTERS.length + 1} />
      </div>
    </>
  );
}

function VisitorsTab() {
  return (
    <>
      <PageTitle>Visitors</PageTitle>
      <VisitorsPanel />
    </>
  );
}

function InsightsTab() {
  return (
    <>
      <PageTitle>Insights</PageTitle>
      <InsightsColumn />
    </>
  );
}

const TABS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/phone", label: "Home", icon: House, end: true },
  { to: "/phone/rooms", label: "Rooms", icon: LayoutGrid },
  { to: "/phone/cameras", label: "Cameras", icon: Cctv },
  { to: "/phone/devices", label: "Devices", icon: Cpu },
  { to: "/phone/visitors", label: "Visitors", icon: Users },
  { to: "/phone/insights", label: "Insights", icon: ChartColumn },
];

function TabBar() {
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="glass pointer-events-auto flex w-full max-w-sm gap-1 rounded-full p-1.5">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            onClick={() => navigator.vibrate?.(8)}
            className={({ isActive }) =>
              clsx(
                "flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 text-[11px] font-semibold transition-colors",
                isActive ? "bg-[var(--chip-off)] text-text" : "text-text-dim",
              )
            }
          >
            <tab.icon size={21} />
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/**
 * The phone layout at /phone — installed as a PWA (see public/manifest
 * .webmanifest, whose start_url points here). Same data, tiles, room cards
 * and night mode as the wall tablet's HomeScreen, rearranged into one
 * column with a bottom tab bar for one-handed use.
 */
export function PhoneScreen() {
  const { entities } = useHa();
  const { pathname } = useLocation();
  const weather = entities[CURATED_WEATHER_ENTITY];
  const isNight = isNightFor(entities["sun.sun"]?.state);

  return (
    <div className={clsx("relative h-full", isNight && "home-night")} data-sheet-root>
      <WeatherBackground condition={weather?.state} isNight={isNight} />

      {/* Keyed by path so switching tabs starts at the top and replays the
          entrance animation. No z-index on purpose: that would trap the
          tiles' pop-ups (z-50) below the tab bar (z-40). It still paints
          over the weather photo, which comes first at z-index 0. */}
      <div
        key={pathname}
        className="relative h-full overflow-y-auto px-4 pb-32 pt-[calc(env(safe-area-inset-top)+1.5rem)]"
      >
        <Routes>
          <Route
            index
            element={
              <>
                <PhoneHeader />
                <StatusBar variant="phone" />
              </>
            }
          />
          <Route path="rooms" element={<RoomsTab />} />
          <Route path="cameras" element={<CamerasTab />} />
          <Route path="devices" element={<DevicesTab />} />
          <Route path="visitors" element={<VisitorsTab />} />
          <Route path="insights" element={<InsightsTab />} />
        </Routes>
      </div>

      <TabBar />
      <QuickActionLink />
      <ThermostatAwayLink />
    </div>
  );
}
