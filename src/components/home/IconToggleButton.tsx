import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

export function IconToggleButton({
  icon: Icon,
  label,
  on,
  accent,
  spinWhenOn,
  compact,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  on: boolean;
  accent: string;
  /** Spin the icon while on — for fans. */
  spinWhenOn?: boolean;
  /** Smaller button that fills its share of the row — the 800×480 wall
   * screen fits four per room tile. */
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => {
        // A short buzz on Android so a tap registers without looking;
        // no-op where vibration isn't supported (iOS, desktop).
        navigator.vibrate?.(12);
        onClick();
      }}
      aria-pressed={on}
      title={label}
      className={clsx(
        "flex shrink-0 flex-col items-center justify-center px-1 transition-[background-color,color,box-shadow,transform] duration-300 active:scale-95",
        compact ? "h-full min-w-0 max-w-[76px] flex-1 gap-1 rounded-[14px]" : "h-[76px] w-[88px] gap-1.5 rounded-[18px]",
      )}
      style={
        on
          ? {
              backgroundColor: accent,
              color: "#fff",
              // Glow + soft ring so "on" reads from across the room.
              boxShadow: `0 8px 22px -6px ${accent}, 0 0 0 3px ${accent}38`,
            }
          : { backgroundColor: "var(--chip-off)", color: accent }
      }
    >
      <Icon
        size={compact ? 22 : 28}
        strokeWidth={2}
        className={clsx(
          "transition-transform duration-300",
          on && "scale-110 drop-shadow-[0_0_6px_rgba(255,255,255,0.7)]",
          on && spinWhenOn && "spin-slow",
        )}
      />
      <span
        className={clsx(
          "w-full truncate text-center font-semibold leading-tight",
          compact ? "text-[10.5px]" : "text-xs",
        )}
      >
        {label}
      </span>
    </button>
  );
}
