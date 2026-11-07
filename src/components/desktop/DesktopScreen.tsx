import { createElement, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/share-tech-mono";
import "@fontsource/righteous";
import "@fontsource/pacifico";
import "@fontsource-variable/outfit";
import "@fontsource/bebas-neue";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource-variable/cinzel";
import "@fontsource/uncial-antiqua";
import "@fontsource-variable/nunito";
import "@fontsource-variable/josefin-sans";
import "./themes.css";
import "./themes-fantasy.css";
import {
  Cctv,
  ChartColumn,
  Cpu,
  LayoutDashboard,
  LayoutGrid,
  ListTree,
  LogOut,
  Music,
  Palette,
  Settings,
  Tablet,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CURATED_CAMERAS, CURATED_QUICK_ACTIONS, CURATED_ROOMS, CURATED_WEATHER_ENTITY, HOUSEHOLD_PEOPLE, type QuickAction } from "../../config/curatedHome";
import { CURATED_COMPUTERS } from "../../config/computers";
import { useHa } from "../../ha/HaProvider";
import { useNow } from "../../lib/useNow";
import { GamingCard } from "../devices/GamingCard";
import { QuickActionToast } from "../home/QuickActionToast";
import { SpotifySearchModal } from "../home/SpotifySearchModal";
import { weatherIcon } from "../home/statusIcons";
import { DetectionsPanel, EnergyBreakdown, IndoorPanel, LightsPanel, PresencePanel } from "./analysis";
import { DevicesSummary, FleetTable, NetworkConsole, NotifyPanel, ScreenTimePanel, ServerPanel, WorkstationPanel } from "./devices";
import { VisitorsConsole } from "./visitors";
import { FaceScanPanel } from "./faceScan";
import { ClimatePanel, OnNowPanel, RoomPanel, RoomsMatrix, SprinklerPanel, TvPanel, VacuumPanel } from "./control";
import { useIssues, useOpenings } from "./data";
import {
  CameraTile,
  EventStream,
  HealthPanel,
  KpiRow,
  OpeningsTimeline,
  PowerPanel,
  SystemsPanel,
  WeatherPanel,
} from "./monitor";
import { Btn, C, Dot, Label } from "./ui";
import { ThemePicker } from "./ThemePicker";
import { themeVars, useDesktopTheme, type DesktopTheme } from "./themes";

interface Page {
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
}

const PAGES: Page[] = [
  { key: "overview", to: "/desktop", label: "Overview", icon: LayoutDashboard },
  { key: "rooms", to: "/desktop/rooms", label: "Rooms", icon: LayoutGrid },
  { key: "security", to: "/desktop/security", label: "Security", icon: Cctv },
  { key: "energy", to: "/desktop/energy", label: "Energy", icon: Zap },
  { key: "devices", to: "/desktop/devices", label: "Devices", icon: Cpu },
  { key: "insights", to: "/desktop/insights", label: "Insights", icon: ChartColumn },
  { key: "visitors", to: "/desktop/visitors", label: "Visitors", icon: Users },
];

const ACTION_COLORS = (): Record<string, string> => ({ leaving: C.amber, party: C.pink, good_night: C.violet });

/** A panel that fills its grid cell instead of sizing it (so a long list
 * scrolls inside rather than stretching the row). */
function Fill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("relative min-h-[320px]", className)}>
      <div className="absolute inset-0 flex [&>section]:flex-1">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- Pages */

function Overview({ go }: { go: (k: string) => void }) {
  const cams = CURATED_CAMERAS.filter((c) => c.sidebar);
  return (
    <>
      <KpiRow go={go} />
      <div className="grid gap-3 xl:grid-cols-12">
        <PowerPanel className="xl:col-span-7" height={196} delay={80} />
        <WeatherPanel className="xl:col-span-5" delay={120} />
      </div>
      <div className="grid gap-3 xl:grid-cols-12">
        <RoomsMatrix className="xl:col-span-5" delay={160} />
        <div className="dx-in grid grid-cols-2 content-start gap-2 xl:col-span-4" style={{ animationDelay: "200ms" }}>
          {cams.map((c, i) => (
            <CameraTile key={c.entityId} entityId={c.entityId} label={c.label} className={i === 0 ? "col-span-2 aspect-video" : "aspect-video"} />
          ))}
        </div>
        <Fill className="xl:col-span-3">
          <EventStream delay={240} />
        </Fill>
      </div>
      <div className="grid gap-3 xl:grid-cols-12">
        <OpeningsTimeline className="xl:col-span-5" delay={280} />
        <SystemsPanel className="xl:col-span-4" delay={300} />
        <HealthPanel className="xl:col-span-3" delay={320} />
      </div>
    </>
  );
}

function Rooms() {
  return (
    <>
      <div className="grid gap-3 xl:grid-cols-12">
        <div className="grid content-start gap-3 md:grid-cols-2 xl:col-span-9 2xl:grid-cols-4">
          {CURATED_ROOMS.map((r, i) => (
            <RoomPanel key={r.key} room={r} index={i} />
          ))}
        </div>
        <Fill className="min-h-[520px] xl:col-span-3">
          <OnNowPanel delay={120} />
        </Fill>
      </div>
      <div className="grid items-start gap-3 xl:grid-cols-3">
        <TvPanel delay={200} />
        <VacuumPanel delay={240} />
        <SprinklerPanel delay={280} />
      </div>
    </>
  );
}

function Security() {
  return (
    <>
      <div className="dx-in grid grid-cols-2 gap-2 xl:grid-cols-3">
        {CURATED_CAMERAS.map((c) => (
          <CameraTile key={c.entityId} entityId={c.entityId} label={c.label} />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-12">
        <OpeningsTimeline className="xl:col-span-5" delay={100} />
        <Fill className="xl:col-span-4">
          <EventStream delay={140} hours={48} />
        </Fill>
        <HealthPanel className="xl:col-span-3" delay={180} />
      </div>
      <DetectionsPanel delay={220} />
    </>
  );
}

function Energy() {
  return (
    <>
      <PowerPanel height={240} />
      <EnergyBreakdown delay={80} />
      <div className="grid gap-3 xl:grid-cols-12">
        <ClimatePanel className="xl:col-span-5" delay={160} />
        <IndoorPanel className="xl:col-span-7" delay={200} />
      </div>
    </>
  );
}

function Devices() {
  return (
    <>
      <DevicesSummary />
      <FleetTable delay={60} />
      <ServerPanel delay={100} />
      <div className="grid gap-3 xl:grid-cols-3">
        {CURATED_COMPUTERS.filter((c) => c.key !== "skylab").map((c, i) => (
          <WorkstationPanel key={c.key} c={c} index={i} />
        ))}
      </div>
      <NetworkConsole delay={180} />
      <div className="grid items-start gap-3 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <ScreenTimePanel delay={220} />
        </div>
        <div className="xl:col-span-4">
          <NotifyPanel delay={260} />
        </div>
      </div>
    </>
  );
}

function Insights() {
  return (
    <>
      <FaceScanPanel />
      <div className="grid items-start gap-3 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <PresencePanel delay={60} />
        </div>
        <div className="xl:col-span-5">
          <LightsPanel delay={100} />
        </div>
      </div>
      <GamingCard index={2} />
    </>
  );
}

function Visitors() {
  return <VisitorsConsole />;
}

/* --------------------------------------------------------------- Shell */

function Rail({ theme }: { theme: DesktopTheme }) {
  const { logout } = useHa();
  const { open } = useOpenings();
  const { issues } = useIssues();
  const flags: Record<string, number> = { security: open.length + issues.filter((i) => i.severity === "danger").length };

  const link = (to: string, label: string, Icon: LucideIcon, end = false, badge = 0, key?: string) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        clsx(
          "dx-nav group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
          isActive ? "active bg-dx-primary/10 text-dx-primary" : "text-dx-faint hover:bg-white/[0.04] hover:text-dx-text",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute -left-[14px] h-5 w-[3px] rounded-r bg-dx-primary shadow-[0_0_10px_var(--color-dx-primary)]" />}
          <Icon size={18} />
          {badge > 0 && (
            <span className="dx-num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-dx-amber px-1 text-[9px] font-bold text-black">
              {badge}
            </span>
          )}
          <span className="pointer-events-none absolute left-[52px] z-50 whitespace-nowrap rounded border border-white/10 bg-dx-bg px-2 py-1 text-[11px] font-semibold text-dx-text opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
            {label}
            {key && <span className="dx-num ml-2 text-dx-faint">{key}</span>}
          </span>
        </>
      )}
    </NavLink>
  );

  return (
    <nav className="dx-rail relative z-20 flex w-[68px] shrink-0 flex-col items-center gap-1.5 border-r border-dx-line py-4">
      <div className="dx-logo mb-4 flex h-10 w-10 items-center justify-center rounded-lg text-[15px] font-bold">{theme.mark}</div>
      {PAGES.map((p, i) => link(p.to, p.label, p.icon, p.key === "overview", flags[p.key] ?? 0, String(i + 1)))}
      <div className="mt-auto flex flex-col items-center gap-1.5">
        {link("/overview", "All areas", ListTree)}
        {link("/", "Tablet layout", Tablet, true)}
        {link("/settings", "Settings", Settings)}
        <button onClick={logout} aria-label="Disconnect" title="Disconnect" className="flex h-10 w-10 items-center justify-center rounded-lg text-dx-faint hover:bg-white/[0.04] hover:text-dx-red">
          <LogOut size={17} />
        </button>
      </div>
    </nav>
  );
}

function TopBar({
  title,
  onAction,
  onMusic,
  onThemes,
}: {
  title: string;
  onAction: (a: QuickAction) => void;
  onMusic: () => void;
  onThemes: () => void;
}) {
  const { entities, status, hassUrl } = useHa();
  const now = useNow(1000);
  const w = entities[CURATED_WEATHER_ENTITY];
  const temp = w?.attributes.temperature as number | undefined;
  return (
    <header className="dx-topbar relative z-10 flex h-[60px] shrink-0 items-center gap-5 border-b border-dx-line px-6 backdrop-blur-md">
      <div className="min-w-0">
        <Label className="text-dx-faint">Home / Ops</Label>
        <h1 className="dx-h1 truncate text-[19px] font-semibold uppercase tracking-[0.06em] text-dx-text">{title}</h1>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {CURATED_QUICK_ACTIONS.map((a) => (
          <Btn key={a.key} onClick={() => onAction(a)} disabled={a.entityIds.length === 0} title={a.description} color={ACTION_COLORS()[a.key]}>
            <a.icon size={12} /> {a.label}
          </Btn>
        ))}
        <Btn onClick={onMusic} color={C.green} title="Search Spotify and play on the living room TV">
          <Music size={12} /> Music
        </Btn>
        <Btn onClick={onThemes} title="Change the theme (T)">
          <Palette size={12} /> Theme
        </Btn>
      </div>

      <div className="flex items-center gap-4 border-l border-dx-line pl-5">
        {w && (
          <div className="flex items-center gap-1.5 text-dx-cyan">
            {createElement(weatherIcon(w.state), { size: 16 })}
            <span className="dx-num text-[14px] text-dx-text">{temp === undefined ? "—" : Math.round(temp)}°</span>
          </div>
        )}
        <div className="flex -space-x-1.5">
          {HOUSEHOLD_PEOPLE.map((id) => {
            const p = entities[id];
            if (!p) return null;
            const home = p.state === "home";
            const pic = p.attributes.entity_picture as string | undefined;
            const name = (p.attributes.friendly_name as string | undefined) ?? id;
            return (
              <div
                key={id}
                title={`${name} · ${home ? "home" : p.state === "not_home" ? "away" : p.state}`}
                className="relative h-7 w-7 rounded-full border-2"
                style={{ borderColor: home ? C.green : C.faint }}
              >
                {pic ? (
                  <img src={`${hassUrl ?? ""}${pic}`} alt="" className={clsx("h-full w-full rounded-full object-cover", !home && "grayscale opacity-60")} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-dx-raise text-[11px] font-semibold text-dx-text">{name.charAt(0)}</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-right">
          <div className="dx-num text-[17px] leading-none text-dx-text">{now.toLocaleTimeString(undefined, { hour12: false })}</div>
          <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-[0.12em] text-dx-dim">
            <Dot color={status === "connected" ? C.green : C.amber} pulse={status === "connected"} />
            {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          </div>
        </div>
      </div>
    </header>
  );
}

/** Number keys 1–7 jump between pages (not while typing or in a dialog). */
function useShortcuts(cycleTheme: () => void) {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "t" || e.key === "T") return cycleTheme();
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < PAGES.length) navigate(PAGES[i].to);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, cycleTheme]);
}

/**
 * The desktop layout at /desktop: a dark, data-dense ops console for a
 * monitor, mouse and keyboard — neon charts, gauges and timelines instead of
 * the tablet's big touch tiles. Icon rail on the left (keys 1–7), a top bar
 * with quick actions, weather, people and the clock, and seven pages.
 */
export function DesktopScreen() {
  const { callService } = useHa();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [music, setMusic] = useState(false);
  const [toast, setToast] = useState<{ action: QuickAction; nonce: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const { theme, setTheme, cycle } = useDesktopTheme();
  useShortcuts(cycle);

  const page = PAGES.find((p) => p.to === pathname.replace(/\/$/, "")) ?? PAGES[0];
  const go = (key: string) => navigate(PAGES.find((p) => p.key === key)?.to ?? "/desktop");

  function run(action: QuickAction) {
    if (action.entityIds.length === 0) return;
    callService("homeassistant", action.action, {}, { entity_id: action.entityIds }).catch(() => {});
    setToast((t) => ({ action, nonce: (t?.nonce ?? 0) + 1 }));
  }

  useEffect(() => {
    document.title = `${page.label} · Home`;
  }, [page.label]);

  return (
    <div className="dx relative flex h-full overflow-hidden" data-sheet-root data-dx-theme={theme.id} style={themeVars(theme)}>
      <div className="dx-fx" />
      <Rail theme={theme} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <TopBar title={page.label} onAction={run} onMusic={() => setMusic(true)} onThemes={() => setPicking(true)} />
        <main key={`${pathname}:${theme.id}`} className="dx-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mx-auto flex max-w-[2200px] flex-col gap-3">
            <Routes>
              <Route index element={<Overview go={go} />} />
              <Route path="rooms" element={<Rooms />} />
              <Route path="security" element={<Security />} />
              <Route path="energy" element={<Energy />} />
              <Route path="devices" element={<Devices />} />
              <Route path="insights" element={<Insights />} />
              <Route path="visitors" element={<Visitors />} />
            </Routes>
          </div>
        </main>
      </div>
      {music && <SpotifySearchModal onClose={() => setMusic(false)} />}
      {picking && <ThemePicker current={theme.id} onPick={setTheme} onClose={() => setPicking(false)} />}
      {toast && <QuickActionToast key={`${toast.action.key}-${toast.nonce}`} action={toast.action} onDismiss={() => setToast(null)} />}
    </div>
  );
}
