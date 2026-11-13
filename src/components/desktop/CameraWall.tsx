import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, Maximize, Minimize } from "lucide-react";
import { CURATED_CAMERAS } from "../../config/curatedHome";
import { CameraTile } from "./monitor";

/** Columns that show each 16:9 frame biggest in a `w`×`h` area (ties go to more columns). */
function bestCols(n: number, w: number, h: number) {
  let best = 1;
  let bestW = 0;
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const frameW = Math.min(w / c, ((h / rows) * 16) / 9);
    if (frameW >= bestW) {
      bestW = frameW;
      best = c;
    }
  }
  return best;
}

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

/**
 * /desktop/cameras: every camera and nothing else, sized to fill the window —
 * meant for a secondary monitor. The controls and cursor hide after a few
 * idle seconds; F toggles browser full screen, Esc goes back to Security.
 */
export function CameraWall() {
  const navigate = useNavigate();
  const { w, h } = useViewport();
  const cols = bestCols(CURATED_CAMERAS.length, w, h);
  const [idle, setIdle] = useState(false);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.title = "Cameras · Home";
  }, []);

  useEffect(() => {
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setIdle(true), 2500);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
    };
  }, []);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return; // a live view is open; Esc closes that
      if (e.key === "f" || e.key === "F") toggleFull();
      else if (e.key === "Escape" && !document.fullscreenElement) navigate("/desktop/security");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const rows = Math.ceil(CURATED_CAMERAS.length / cols);
  return (
    <div className={clsx("relative h-full w-full bg-black", idle && "cursor-none")}>
      <div
        className="grid h-full w-full gap-1 p-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {CURATED_CAMERAS.map((c) => (
          <CameraTile key={c.entityId} entityId={c.entityId} label={c.label} everyMs={3000} fit="contain" className="h-full min-h-0 w-full" />
        ))}
      </div>
      <div
        className={clsx(
          "absolute right-3 top-3 z-10 flex gap-1.5 transition-opacity duration-300",
          idle ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <button
          onClick={toggleFull}
          title={full ? "Exit full screen (F)" : "Full screen (F)"}
          className="flex items-center gap-1.5 rounded-md bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85 hover:bg-black/90 hover:text-white"
        >
          {full ? <Minimize size={13} /> : <Maximize size={13} />} {full ? "Exit full screen" : "Full screen"}
        </button>
        <button
          onClick={() => {
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            navigate("/desktop/security");
          }}
          title="Back to Security (Esc)"
          className="flex items-center gap-1.5 rounded-md bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85 hover:bg-black/90 hover:text-white"
        >
          <ArrowLeft size={13} /> Back
        </button>
      </div>
    </div>
  );
}
