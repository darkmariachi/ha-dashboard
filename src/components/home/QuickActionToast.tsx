import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { QuickAction } from "../../config/curatedHome";

const AUTO_DISMISS_MS = 5000;
const FADE_MS = 300;

/**
 * Confirmation toast shown after tapping a Quick Actions button — fades/
 * scales in, sits for a few seconds (or until dismissed), then fades out.
 * Stays controlled from outside (`action`/`onDismiss`) so QuickActionsCard
 * owns when one is showing; this just owns the enter/exit animation and the
 * auto-dismiss timer.
 */
export function QuickActionToast({
  action,
  onDismiss,
}: {
  action: QuickAction;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function close() {
    if (closing) return;
    clearTimeout(dismissTimerRef.current);
    setClosing(true);
    setTimeout(onDismiss, FADE_MS);
  }

  useEffect(() => {
    // Double rAF so the initial (hidden) styles actually paint before we
    // flip to visible — otherwise the browser can coalesce both states into
    // one frame and skip the transition entirely.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setVisible(true));
    });
    dismissTimerRef.current = setTimeout(close, AUTO_DISMISS_MS);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(dismissTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={clsx(
        "fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity",
        visible && !closing ? "opacity-100" : "opacity-0",
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      data-tv-scope
    >
      <div className="absolute inset-0 bg-black/30" onClick={close} aria-hidden />

      <div
        className={clsx(
          "relative flex w-full max-w-lg flex-col items-center gap-4 rounded-3xl border border-border bg-surface p-10 text-center shadow-xl transition-all",
          visible && !closing ? "scale-100 opacity-100" : "scale-90 opacity-0",
        )}
        style={{ transitionDuration: `${FADE_MS}ms` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-chip text-text">
          <action.icon size={30} strokeWidth={1.75} />
        </div>
        <div className="text-2xl font-semibold text-text">{action.label}</div>
        <p className="text-lg text-text-dim">{action.description}</p>
        <button
          onClick={close}
          data-tv-close
          className="mt-2 rounded-full bg-chip px-6 py-3 text-base font-medium text-text transition-colors hover:bg-chip-hover"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
