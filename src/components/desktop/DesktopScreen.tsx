import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  Cctv,
  ChartColumn,
  Cpu,
  LayoutDashboard,
  LayoutGrid,
  ListTree,
  LogOut,
  Settings,
  Smartphone,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  CURATED_CAMERAS,
  CURATED_CLIMATE_ENTITY,
  CURATED_QUICK_ACTIONS,
  CURATED_ROOMS,
  CURATED_TVS,
  CURATED_WEATHER_ENTITY,
  type QuickAction,
} from "../../config/curatedHome";
import { CURATED_COMPUTERS } from "../../config/computers";
import { useHa } from "../../ha/HaProvider";
import { resolveCuratedCamera } from "../../lib/entityHelpers";
import { roomColorFor } from "../../lib/roomPalette";
import { isNightFor } from "../../lib/weatherTheme";
import { CameraCard } from "../cards/CameraCard";
import { ClimateControlModal } from "../climate/ClimateControlModal";
import { ComputerCard } from "../devices/ComputerCard";
import { GamingCard } from "../devices/GamingCard";
import { NotificationsCard } from "../devices/NotificationsCard";
import { YouTubeCard } from "../devices/YouTubeCard";
import { ActivityFeed } from "../home/ActivityFeed";
import { DoorsModal } from "../home/DoorsModal";
import { OnNowModal } from "../home/OnNowModal";
import { PowerModal } from "../home/PowerModal";
import { QuickActionToast } from "../home/QuickActionToast";
import { RoomCard } from "../home/RoomCard";
import { InlineSheet } from "../home/Sheet";
import { SpotifySearchModal } from "../home/SpotifySearchModal";
import { SprinklersCard } from "../home/SprinklersCard";
import { TvCard } from "../home/TvCard";
import { VacuumCard } from "../home/VacuumCard";
import { WeatherBackground } from "../home/WeatherBackground";
import { LightsInsightCard } from "../insights/LightsInsightCard";
import { PresenceInsightCard } from "../insights/PresenceInsightCard";
import { VisitorsPanel } from "../visitors/VisitorsPanel";
import { DesktopHeader } from "./DesktopHeader";
import {
  HealthPanel,
  IndoorPanel,
  KpiStrip,
  NetworkPanel,
  OpeningsPanel,
  SystemsPanel,
  useHealthIssues,
  useOpenings,
  WeekPowerPanel,
} from "./panels";

/** Camera stills refresh this often; click one for the live stream. */
const CAMERA_SNAPSHOT_MS = 4_000;

const ACTION_ACCENTS: Record<string, string> = {
  leaving: roomColorFor(4).accent,
  party: roomColorFor(5).accent,
  good_night: roomColorFor(3).accent,
};

interface Page {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const PAGES: Page[] = [
  { to: "/desktop", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/desktop/rooms", label: "Rooms", icon: LayoutGrid },
  { to: "/desktop/security", label: "Security", icon: Cctv },
  { to: "/desktop/energy", label: "Energy & climate", icon: Zap },
  { to: "/desktop/devices", label: "Devices & network", icon: Cpu },
  { to: "/desktop/insights", label: "Insights", icon: ChartColumn },
  { to: "/desktop/visitors", label: "Visitors", icon: Users },
];

function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="rise hero-shadow text-white">
      <h1 className="text-[34px] font-semibold tracking-[-0.6px]">{title}</h1>
      {subtitle && <p className="text-[14px] opacity-85">{subtitle}</p>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="hero-shadow mx-1 -mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">{children}</h2>
  );
}

/** A refreshing camera still (bare cards carry their own name); click it for
 * the live stream. */
function LabeledCamera({ entityId, label }: { entityId: string; label: string }) {
  const { entitiesWithArea } = useHa();
  return (
    <CameraCard ent={resolveCuratedCamera(entitiesWithArea, { entityId, label })} bare snapshotEveryMs={CAMERA_SNAPSHOT_MS} />
  );
}

function OverviewPage() {
  const cameras = CURATED_CAMERAS.filter((c) => c.sidebar);
  return (
    <>
      <DesktopHeader />
      <KpiStrip />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {CURATED_ROOMS.map((room, i) => (
            <RoomCard key={room.key} room={room} index={i} />
          ))}
        </div>
        <div className="rise flex flex-col gap-3" style={{ animationDelay: "350ms" }}>
          {cameras.map((c) => (
            <LabeledCamera key={c.entityId} entityId={c.entityId} label={c.label} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <HealthPanel delay={400} />
        <NetworkPanel delay={450} />
        <SystemsPanel delay={500} />
      </div>

      <SectionLabel>Recent camera activity</SectionLabel>
      <ActivityFeed compact />
    </>
  );
}

function RoomsPage() {
  return (
    <>
      <PageTitle title="Rooms" subtitle="Every room's switches and Hue lights, the TVs, the vacuum and the sprinklers." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(340px,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {CURATED_ROOMS.map((room, i) => (
              <RoomCard key={room.key} room={room} index={i} />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {CURATED_TVS.length > 0 && <TvCard index={CURATED_ROOMS.length} />}
            <SprinklersCard index={CURATED_ROOMS.length + 1} />
          </div>
          <VacuumCard index={CURATED_ROOMS.length + 2} wide />
        </div>
        <div className="xl:sticky xl:top-0 xl:max-h-[calc(100vh-4rem)] xl:self-start [&>section]:max-h-[calc(100vh-4rem)]">
          <InlineSheet>
            <OnNowModal onClose={() => {}} />
          </InlineSheet>
        </div>
      </div>
    </>
  );
}

function SecurityPage() {
  const { open } = useOpenings();
  const { issues } = useHealthIssues();
  const danger = issues.filter((i) => i.severity === "danger");
  return (
    <>
      <PageTitle
        title="Security"
        subtitle={
          danger.length
            ? danger.map((d) => `${d.label}: ${d.detail}`).join(" · ")
            : open.length
              ? `${open.length} open: ${open.map((o) => o.label).join(", ")}`
              : "Everything's closed and quiet."
        }
      />
      <div className="rise grid gap-3 md:grid-cols-2 2xl:grid-cols-3" style={{ animationDelay: "80ms" }}>
        {CURATED_CAMERAS.map((c) => (
          <LabeledCamera key={c.entityId} entityId={c.entityId} label={c.label} />
        ))}
      </div>
      <p className="hero-shadow -mt-2 text-center text-xs text-white/75">
        Stills refresh every {CAMERA_SNAPSHOT_MS / 1000}s · click a camera for live video
      </p>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4">
          <InlineSheet>
            <DoorsModal onClose={() => {}} />
          </InlineSheet>
        </div>
        <div className="flex flex-col gap-4">
          <OpeningsPanel delay={150} />
        </div>
        <div className="rise" style={{ animationDelay: "200ms" }}>
          <ActivityFeed limit={60} />
        </div>
      </div>
    </>
  );
}

function EnergyPage() {
  return (
    <>
      <PageTitle title="Energy & climate" subtitle="Live usage, solar, appliances, the thermostat and indoor trends." />
      <WeekPowerPanel delay={60} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <InlineSheet>
          <PowerModal onClose={() => {}} />
        </InlineSheet>
        <div className="flex flex-col gap-4">
          <ClimateControlModal entityId={CURATED_CLIMATE_ENTITY} onClose={() => {}} inline />
          <IndoorPanel delay={150} />
        </div>
      </div>
    </>
  );
}

function DevicesPage() {
  return (
    <>
      <PageTitle title="Devices & network" subtitle="Computers, the home server, the internet connection and screen time." />
      <div className="grid gap-4 xl:grid-cols-2">
        {CURATED_COMPUTERS.map((c, i) => (
          <ComputerCard key={c.key} computer={c} index={i} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <NetworkPanel delay={200} hours={24} />
        <YouTubeCard index={CURATED_COMPUTERS.length} />
        <NotificationsCard index={CURATED_COMPUTERS.length + 1} />
      </div>
    </>
  );
}

function InsightsPage() {
  return (
    <>
      <PageTitle title="Insights" subtitle="Patterns from Home Assistant's history: who's home when, lights, console time." />
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <PresenceInsightCard />
        <LightsInsightCard index={1} />
        <GamingCard index={2} />
      </div>
    </>
  );
}

function VisitorsPage() {
  return (
    <>
      <PageTitle title="Visitors" subtitle="Devices that joined the Wi-Fi and aren't the household's." />
      <div className="max-w-3xl">
        <VisitorsPanel />
      </div>
    </>
  );
}

/** Left navigation rail: pages, quick actions, music and links out. */
function NavRail({ onRunAction, onMusic }: { onRunAction: (a: QuickAction) => void; onMusic: () => void }) {
  const { status, logout } = useHa();
  const { open } = useOpenings();
  const { issues } = useHealthIssues();
  const badges: Record<string, number> = {
    "/desktop/security": open.length + issues.filter((i) => i.severity === "danger").length,
  };

  return (
    <nav className="glass flex h-full w-[232px] shrink-0 flex-col gap-1 overflow-y-auto rounded-none border-y-0 border-l-0 px-3 py-5">
      <div className="mb-4 flex items-center gap-2.5 px-2">
        <img src="/icon.svg" alt="" className="h-8 w-8 rounded-[10px]" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text">Home</div>
          <div className="flex items-center gap-1.5 text-[11px] text-text-dim">
            <span
              className={clsx("h-1.5 w-1.5 rounded-full", status === "connected" ? "bg-[#3ee08f]" : "bg-warn")}
            />
            {status === "connected" ? "Live" : status}
          </div>
        </div>
      </div>

      {PAGES.map((p, i) => (
        <NavLink
          key={p.to}
          to={p.to}
          end={p.end}
          title={`${p.label} (${i + 1})`}
          className={({ isActive }) =>
            clsx(
              "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors",
              isActive ? "bg-[var(--chip-off)] text-text shadow-sm" : "text-text-dim hover:bg-chip hover:text-text",
            )
          }
        >
          <p.icon size={17} />
          <span className="flex-1 truncate">{p.label}</span>
          {badges[p.to] ? (
            <span className="rounded-full bg-[#d9822b] px-1.5 text-[10.5px] font-bold text-white">{badges[p.to]}</span>
          ) : (
            <kbd className="hidden text-[10px] text-text-dim/70 group-hover:inline">{i + 1}</kbd>
          )}
        </NavLink>
      ))}

      <div className="mx-2 mb-1.5 mt-5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-dim">Quick actions</div>
      {CURATED_QUICK_ACTIONS.map((a) => (
        <button
          key={a.key}
          onClick={() => onRunAction(a)}
          disabled={a.entityIds.length === 0}
          title={a.description}
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] font-medium text-text transition-colors hover:bg-chip active:scale-[0.98] disabled:opacity-40"
        >
          <a.icon size={17} style={{ color: ACTION_ACCENTS[a.key] }} />
          {a.label}
        </button>
      ))}
      <button
        onClick={onMusic}
        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] font-medium text-text transition-colors hover:bg-chip"
      >
        <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[#1DB954] text-[9px] font-bold text-white">♪</span>
        Play music…
      </button>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3">
        <NavLink to="/overview" className="flex items-center gap-3 rounded-xl px-3 py-1.5 text-[12.5px] text-text-dim hover:bg-chip hover:text-text">
          <ListTree size={15} /> All areas
        </NavLink>
        <NavLink to="/" className="flex items-center gap-3 rounded-xl px-3 py-1.5 text-[12.5px] text-text-dim hover:bg-chip hover:text-text">
          <Smartphone size={15} /> Tablet layout
        </NavLink>
        <NavLink to="/settings" className="flex items-center gap-3 rounded-xl px-3 py-1.5 text-[12.5px] text-text-dim hover:bg-chip hover:text-text">
          <Settings size={15} /> Settings
        </NavLink>
        <button
          onClick={logout}
          className="flex items-center gap-3 rounded-xl px-3 py-1.5 text-left text-[12.5px] text-text-dim hover:bg-chip hover:text-text"
        >
          <LogOut size={15} /> Disconnect
        </button>
      </div>
    </nav>
  );
}

/** Number keys 1–7 jump between pages (not while typing). */
function usePageShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < PAGES.length) navigate(PAGES[i].to);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

/**
 * The desktop layout at /desktop — for a computer monitor (1280 px and up),
 * with a mouse and keyboard. Same data, night mode and weather backdrop as
 * the tablet, but much denser: a permanent nav rail instead of the drawer,
 * a KPI strip, and the detail sheets that pop up on the tablet and phone
 * (Power, Doors, On right now, the thermostat) laid out as panels — plus
 * things only this layout shows: the full weather and week forecast,
 * internet throughput, house health, indoor and 7-day power trends with
 * hover readouts.
 */
export function DesktopScreen() {
  const { entities, callService } = useHa();
  const { pathname } = useLocation();
  const weather = entities[CURATED_WEATHER_ENTITY];
  const isNight = isNightFor(entities["sun.sun"]?.state);
  const [toast, setToast] = useState<{ action: QuickAction; nonce: number } | null>(null);
  const [musicOpen, setMusicOpen] = useState(false);
  usePageShortcuts();

  function runAction(action: QuickAction) {
    if (action.entityIds.length === 0) return;
    callService("homeassistant", action.action, {}, { entity_id: action.entityIds }).catch(() => {});
    setToast((t) => ({ action, nonce: (t?.nonce ?? 0) + 1 }));
  }

  return (
    <div className={clsx("relative flex h-full", isNight && "home-night")} data-sheet-root>
      <WeatherBackground condition={weather?.state} isNight={isNight} />

      {/* No z-index on either: see PhoneScreen — keeps pop-ups above them. */}
      <div className="relative h-full">
        <NavRail onRunAction={runAction} onMusic={() => setMusicOpen(true)} />
      </div>
      <div key={pathname} className="relative h-full min-w-0 flex-1 overflow-y-auto px-8 pb-12 pt-7">
        <div className="mx-auto flex max-w-[2000px] flex-col gap-5">
          <Routes>
            <Route index element={<OverviewPage />} />
            <Route path="rooms" element={<RoomsPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="energy" element={<EnergyPage />} />
            <Route path="devices" element={<DevicesPage />} />
            <Route path="insights" element={<InsightsPage />} />
            <Route path="visitors" element={<VisitorsPage />} />
          </Routes>
        </div>
      </div>

      {musicOpen && <SpotifySearchModal onClose={() => setMusicOpen(false)} />}
      {toast && (
        <QuickActionToast key={`${toast.action.key}-${toast.nonce}`} action={toast.action} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
