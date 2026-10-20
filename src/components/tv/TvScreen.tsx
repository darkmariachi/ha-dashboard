import { Cctv, Cpu, House, LayoutGrid, type LucideIcon } from "lucide-react";
import { createElement, useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
import { useTvNav } from "../../lib/tvNav";
import { useNow } from "../../lib/useNow";
import { isNightFor } from "../../lib/weatherTheme";
import { CameraCard } from "../cards/CameraCard";
import { ComputerCard } from "../devices/ComputerCard";
import { GamingCard } from "../devices/GamingCard";
import { YouTubeCard } from "../devices/YouTubeCard";
import { ActivityFeed } from "../home/ActivityFeed";
import { RoomCard } from "../home/RoomCard";
import { SprinklersCard } from "../home/SprinklersCard";
import { StatusBar } from "../home/StatusBar";
import { TvCard } from "../home/TvCard";
import { VacuumCard } from "../home/VacuumCard";
import { weatherIcon, weatherLabel } from "../home/statusIcons";
import { useWeatherForecast } from "../home/useWeatherForecast";
import { WeatherBackground } from "../home/WeatherBackground";
import { WhoIsHome } from "../home/WhoIsHome";

/** The layout is drawn on a 960px-wide canvas — what an Android TV WebView
 * reports at 1080p (density 2) — and zoomed to fit anything else, so it's
 * the same proportions on a 4K panel or in a desktop browser. */
const CANVAS_WIDTH = 960;

function useCanvas() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const zoom = size.width / CANVAS_WIDTH;
  return { zoom, width: CANVAS_WIDTH, height: size.height / zoom };
}

function WeatherGlyph({ condition, size }: { condition: string | undefined; size: number }) {
  // createElement rather than <Icon />: the icon is looked up per render.
  return createElement(weatherIcon(condition), { size, strokeWidth: 1.5 });
}

function round(v: number | undefined) {
  return v === undefined ? "—" : `${Math.round(v)}°`;
}

/** Its own component so the once-a-second tick only re-renders the clock. */
function Clock() {
  const now = useNow(1000);
  const h = now.getHours();
  return (
    <div>
      <div className="text-[64px] font-light leading-[0.9] tracking-[-2.5px] tabular-nums">
        {((h + 11) % 12) + 1}:{String(now.getMinutes()).padStart(2, "0")}
        <span className="ml-1 text-[20px] font-normal tracking-normal opacity-85">{h < 12 ? "AM" : "PM"}</span>
      </div>
      <div className="mt-2 whitespace-nowrap text-[15px] font-medium">
        {greetingFor(h)}, {HOUSEHOLD_NAME}
      </div>
      <div className="text-xs opacity-85">
        {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}

/** The tablet's HomeHero, scaled to the TV canvas: clock and who's home on
 * the left, weather and the next few hours on the right. */
function TvHeader() {
  const { entities } = useHa();
  const now = useNow(60_000);
  const weather = entities[CURATED_WEATHER_ENTITY];
  const hourly = useWeatherForecast(CURATED_WEATHER_ENTITY, "hourly");
  const daily = useWeatherForecast(CURATED_WEATHER_ENTITY, "daily");
  const temp = weather?.attributes.temperature as number | undefined;
  const today = daily?.[0];
  const nextHours = (hourly ?? [])
    .filter((f) => new Date(f.datetime).getTime() > now.getTime())
    .slice(0, 3);

  return (
    <header className="rise hero-shadow mb-4 flex items-end justify-between gap-4 text-white">
      <div className="flex items-end gap-5">
        <Clock />
        <WhoIsHome size={32} />
      </div>

      {weather && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <WeatherGlyph condition={weather.state} size={40} />
            <div className="text-[48px] font-light leading-none tracking-[-2px]">
              {temp === undefined ? "—" : Math.round(temp)}°
            </div>
            <div className="whitespace-nowrap text-xs leading-snug opacity-90">
              <div className="text-sm font-semibold">{weatherLabel(weather.state)}</div>
              {today && (
                <div>
                  H {round(today.temperature)} · L {round(today.templow)}
                </div>
              )}
            </div>
          </div>

          {nextHours.length > 0 && (
            <div className="flex gap-1 rounded-[18px] border border-white/25 bg-white/15 p-2 [text-shadow:none] backdrop-blur-md">
              {nextHours.map((f) => (
                <div key={f.datetime} className="flex w-[46px] flex-col items-center gap-1 text-[11px]">
                  {new Date(f.datetime).toLocaleTimeString(undefined, { hour: "numeric" })}
                  <WeatherGlyph condition={f.condition} size={18} />
                  <b className="text-[13px] font-semibold">{round(f.temperature)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="rise hero-shadow mb-3 text-[22px] font-semibold tracking-[-0.4px] text-white">{children}</h1>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="hero-shadow mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">
      {children}
    </h2>
  );
}

function RoomsTab() {
  return (
    <>
      <PageTitle>Rooms</PageTitle>
      <div className="grid grid-cols-2 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2">
        {CURATED_ROOMS.map((room, i) => (
          <RoomCard key={room.key} room={room} index={i} titleLink={false} />
        ))}
      </div>
    </>
  );
}

function CamerasTab() {
  const { entitiesWithArea } = useHa();
  return (
    <>
      <PageTitle>Cameras</PageTitle>
      <div className="grid grid-cols-3 gap-3">
        {CURATED_CAMERAS.map((cam, i) => (
          <div key={cam.entityId} className="rise" style={{ animationDelay: `${100 + i * 50}ms` }}>
            <CameraCard ent={resolveCuratedCamera(entitiesWithArea, cam)} bare />
          </div>
        ))}
      </div>
      <SectionTitle>Recent activity</SectionTitle>
      <div className="rise" style={{ animationDelay: `${100 + CURATED_CAMERAS.length * 50}ms` }}>
        <ActivityFeed compact />
      </div>
    </>
  );
}

function DevicesTab() {
  return (
    <>
      <PageTitle>Devices</PageTitle>
      {/* Two independent columns rather than a grid: the cards' heights vary
          a lot, and a grid would leave gaps under the short ones. */}
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <TvCard index={0} />
          <VacuumCard index={2} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <SprinklersCard index={1} />
          <GamingCard index={3} />
          <YouTubeCard index={4} />
          {CURATED_COMPUTERS.map((c, i) => (
            <ComputerCard key={c.key} computer={c} index={i + 5} />
          ))}
        </div>
      </div>
    </>
  );
}

const TABS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/tv", label: "Home", icon: House, end: true },
  { to: "/tv/rooms", label: "Rooms", icon: LayoutGrid },
  { to: "/tv/cameras", label: "Cameras", icon: Cctv },
  { to: "/tv/devices", label: "Devices", icon: Cpu },
];

function TabRail() {
  return (
    <nav
      data-tv-rail
      className="glass absolute left-6 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1.5 rounded-[26px] p-1.5"
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            clsx(
              "flex w-[60px] flex-col items-center gap-1 rounded-[20px] py-2.5 text-[10px] font-semibold transition-colors",
              isActive ? "bg-[var(--chip-off)] text-text" : "text-text-dim",
            )
          }
        >
          <tab.icon size={22} />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The TV layout at /tv — what the Android TV shell (tv/) loads on the
 * Shield. Same data, tiles, room cards and night mode as the wall tablet's
 * HomeScreen, laid out for a 10-foot screen and driven entirely with the
 * remote's D-pad (see useTvNav): a tab rail on the left, one page of cards
 * on the right, OK to press, Back to close or step out.
 */
export function TvScreen() {
  const { entities } = useHa();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvas = useCanvas();
  const weather = entities[CURATED_WEATHER_ENTITY];
  const isNight = isNightFor(entities["sun.sun"]?.state);
  const onHome = pathname.replace(/\/+$/, "") === "/tv";

  // Back from a tab's rail button goes Home; from Home it leaves the app.
  useTvNav(rootRef, () => {
    if (onHome) return false;
    navigate("/tv");
    return true;
  });

  // Leaving the app (Home button, TV off) drops back to the Home tab, so the
  // Cameras tab's live streams don't keep running in the background.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) navigate("/tv", { replace: true });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [navigate]);

  return (
    <div
      ref={rootRef}
      className={clsx("tv relative overflow-hidden", isNight && "home-night")}
      style={canvas}
      data-sheet-root
    >
      <WeatherBackground condition={weather?.state} isNight={isNight} />
      <TabRail />

      {/* Keyed by path so switching tabs starts at the top and replays the
          entrance animation. No z-index: see PhoneScreen — keeps pop-ups
          above the rail. */}
      <div key={pathname} data-tv-main className="absolute inset-y-0 left-[104px] right-0 overflow-y-auto py-6 pl-2 pr-9">
        <Routes>
          <Route
            index
            element={
              <>
                <TvHeader />
                <StatusBar variant="tv" />
              </>
            }
          />
          <Route path="rooms" element={<RoomsTab />} />
          <Route path="cameras" element={<CamerasTab />} />
          <Route path="devices" element={<DevicesTab />} />
        </Routes>
      </div>
    </div>
  );
}
