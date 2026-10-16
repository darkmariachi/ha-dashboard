import { ChartColumn, Home, LogOut, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { useHa } from "../ha/HaProvider";
import { useConfig } from "../config/ConfigProvider";
import { areaIcon, OVERVIEW_ICON } from "../lib/areaIcons";
import { isRenderable } from "../lib/entityHelpers";
import { slugifyAreaName as slug } from "../lib/slug";

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { areaGroups, logout } = useHa();
  const { config } = useConfig();

  const visibleAreas = areaGroups
    .filter((g) => g.areaId) // skip the synthetic "no area" bucket in nav; shown on Overview instead
    .filter((g) => g.entities.some((e) => isRenderable(e)))
    .sort((a, b) => {
      const order = config.areaOrder;
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      if (ai !== -1 || bi !== -1) {
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      }
      return a.name.localeCompare(b.name);
    });

  return (
    <>
      {/* Backdrop — tapping outside the drawer closes it */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={clsx(
          "fixed inset-0 z-30 bg-black/30 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-surface shadow-xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="px-4 py-5 pl-16">
          <div className="text-sm font-semibold text-text">Home Dashboard</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2">
          <NavItem to="/" icon={Home} label="Home" end onNavigate={onClose} />
          <NavItem to="/insights" icon={ChartColumn} label="Insights" onNavigate={onClose} />
          <NavItem to="/overview" icon={OVERVIEW_ICON} label="All Areas" onNavigate={onClose} />
          <div className="mt-3 mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-text-dim">
            Rooms
          </div>
          {visibleAreas.map((group) => (
            <NavItem
              key={group.areaId}
              to={`/area/${slug(group.name)}`}
              icon={areaIcon(group.name)}
              label={config.areaRenames[group.name] ?? group.name}
              onNavigate={onClose}
            />
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <NavItem to="/settings" icon={Settings} label="Settings" onNavigate={onClose} />
          <button
            onClick={logout}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-dim hover:bg-surface-hover hover:text-text"
          >
            <LogOut size={16} />
            Disconnect
          </button>
        </div>
      </aside>
    </>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  end,
  onNavigate,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  end?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          "mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-accent-soft text-accent"
            : "text-text-dim hover:bg-surface-hover hover:text-text",
        )
      }
    >
      <Icon size={16} />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}
