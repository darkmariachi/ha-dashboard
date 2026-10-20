import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Detail pop-up for a status tile: a bottom sheet on phones, a centered
 * panel on wider screens. Scrolls internally so long logs stay inside it.
 *
 * Rendered through a portal into the screen's root ([data-sheet-root], set
 * by HomeScreen/PhoneScreen) so a sheet opened from inside a glass card
 * isn't trapped by the card's backdrop-filter (which makes position:fixed
 * relative to the card) while still inheriting the night-mode tokens.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" data-tv-scope>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-label={title}
        className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-[26px] border border-border bg-surface shadow-xl sm:max-w-lg sm:rounded-[26px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-text">{title}</div>
            {subtitle && <div className="text-[13px] text-text-dim">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-dim hover:bg-chip hover:text-text"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-5 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    document.querySelector("[data-sheet-root]") ?? document.body,
  );
}

/** Small uppercase heading for a section inside a Sheet. */
export function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-dim">{title}</h3>
      {children}
    </section>
  );
}
