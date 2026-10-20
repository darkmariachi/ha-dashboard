import { Loader2, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { useHa } from "./ha/HaProvider";
import { loadCredentials } from "./ha/connection";
import { primeAudio } from "./lib/alarmSound";
import { AreaPage } from "./components/AreaPage";
import { DoorAlertMonitor } from "./components/DoorAlertMonitor";
import { HomeScreen } from "./components/HomeScreen";
import { InsightsPage } from "./components/insights/InsightsPage";
import { Login } from "./components/Login";
import { OverviewPage } from "./components/OverviewPage";
import { PairPage } from "./components/PairPage";
import { PhoneScreen } from "./components/phone/PhoneScreen";
import { Sidebar } from "./components/Sidebar";
import { SettingsPage } from "./components/SettingsPage";
import { TvScreen } from "./components/tv/TvScreen";

/** Shown while a saved login reconnects on launch. Same navy as the PWA's
 * manifest background, so Android's launch splash fades straight into it. */
function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#18213f] text-white/80">
      <img src="/icon.svg" alt="" className="h-20 w-20 rounded-[22px] shadow-2xl" />
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 size={16} className="animate-spin" />
        Connecting…
      </div>
    </div>
  );
}

function App() {
  const { status } = useHa();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const isPhone = pathname.startsWith("/phone");
  const isTv = pathname.startsWith("/tv");
  const isPair = pathname.startsWith("/pair");
  // Once we've been connected, a drop (phone screen off, Wi-Fi to mobile
  // handoff, HA restart) shouldn't throw everyone back to the login form —
  // the library reconnects on its own, so keep the UI up with a banner.
  // Adjusting state during render (React's documented pattern), like
  // WeatherBackground does.
  const [everConnected, setEverConnected] = useState(false);
  if (status === "connected" && !everConnected) setEverConnected(true);

  // Primes the door-alert AudioContext on the first real tap anywhere in the
  // app, so a later programmatic (non-gesture) alarm play() isn't blocked by
  // the browser's autoplay policy.
  useEffect(() => {
    function onFirstInteraction() {
      primeAudio();
      window.removeEventListener("pointerdown", onFirstInteraction);
    }
    window.addEventListener("pointerdown", onFirstInteraction);
    return () => window.removeEventListener("pointerdown", onFirstInteraction);
  }, []);

  const reconnecting = status === "connecting" && everConnected;
  // With a saved login, HaProvider reconnects on its own at launch; the
  // form only belongs on screen if there's nothing saved or the saved login
  // actually failed (auth-invalid / error keep showing it, with the reason).
  // Checked each render (a cheap localStorage read) so signing out, which
  // clears it, goes straight back to the form.
  if (status !== "connected" && !reconnecting) {
    if (loadCredentials() && (status === "idle" || status === "connecting")) return <Splash />;
    return <Login />;
  }

  return (
    <div className="relative h-full">
      {reconnecting && (
        <div className="fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-md">
            <Loader2 size={14} className="animate-spin" />
            Reconnecting to Home Assistant…
          </div>
        </div>
      )}

      {/* The phone and TV layouts have their own tabs instead of the drawer. */}
      {!isPhone && !isTv && !isPair && (
        <>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="fixed top-4 left-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-text shadow-md transition-transform active:scale-95"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        </>
      )}

      <main className="h-full min-w-0">
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/phone/*" element={<PhoneScreen />} />
          <Route path="/tv/*" element={<TvScreen />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/area/:areaSlug" element={<AreaPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/pair" element={<PairPage />} />
        </Routes>
      </main>

      {/* The loud door alarm is for the wall tablet; a phone away from home
          (or the TV mid-movie) shouldn't start blaring. The Doors tile still
          shows what's open. */}
      {!isPhone && !isTv && !isPair && <DoorAlertMonitor />}
    </div>
  );
}

export default App;
