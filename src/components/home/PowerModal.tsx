import { ArrowDownLeft, ArrowUpRight, Sun, Zap } from "lucide-react";
import type { HassEntities } from "home-assistant-js-websocket";
import { CURATED_ENERGY } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { roomColorFor } from "../../lib/roomPalette";
import { useNow } from "../../lib/useNow";
import { Sheet, SheetSection } from "./Sheet";
import { useEntityHistory } from "./useEntityHistory";
import { energyCost, money, useEnergyPrice } from "../../lib/energyCost";

const USAGE = roomColorFor(4).accent;
const SOLAR = "#2f9e6f";
const CHART_HOURS = 24;
const CHART_BUCKETS = 96; // 15-minute steps
/** The Sense monitor's own sensors share this prefix (from the curated
 * consumption entity, sensor.sense_<id>_energy). */
const SENSE = CURATED_ENERGY.consumption.replace(/_energy$/, "");
/** Sense "devices" that aren't real appliances. */
const NOT_DEVICES = new Set(["solar", "sense_energy_monitor"]);

function num(entities: HassEntities, id: string) {
  const v = parseFloat(entities[id]?.state ?? "");
  return Number.isFinite(v) ? v : null;
}

/** 1234 W -> "1.23 kW", 640 W -> "640 W". */
function watts(w: number | null) {
  if (w === null) return "—";
  return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
}

function kwh(v: number | null) {
  return v === null ? "—" : `${v.toFixed(1)} kWh`;
}

/**
 * Appliances Sense has learned, discovered from the entity list: every
 * sensor.<x>_power that has a matching sensor.<x>_daily_energy.
 */
function senseDevices(entities: HassEntities) {
  const out: { name: string; power: number; today: number | null }[] = [];
  for (const id of Object.keys(entities)) {
    const m = id.match(/^sensor\.(.+)_power$/);
    if (!m || NOT_DEVICES.has(m[1]) || !entities[`sensor.${m[1]}_daily_energy`]) continue;
    const power = num(entities, id);
    if (power === null) continue;
    const name = ((entities[id].attributes.friendly_name as string | undefined) ?? m[1])
      .replace(/\s*Power$/i, "");
    out.push({ name, power, today: num(entities, `sensor.${m[1]}_daily_energy`) });
  }
  return out.sort((a, b) => b.power - a.power);
}

/** Usage (filled) vs solar (line) over the last 24 h, with hour ticks. */
function PowerChart({ usage, solar, now }: { usage: number[]; solar: number[] | null; now: number }) {
  const w = 320;
  const h = 120;
  const max = Math.max(100, ...usage, ...(solar ?? []));
  const x = (i: number, n: number) => (i / (n - 1)) * w;
  const y = (v: number) => h - (Math.max(0, v) / max) * (h - 6);
  const path = (vals: number[]) => vals.map((v, i) => `${x(i, vals.length).toFixed(1)} ${y(v).toFixed(1)}`).join(" L");

  const start = now - CHART_HOURS * 3600 * 1000;
  const ticks: { pos: number; label: string }[] = [];
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  for (let t = first.getTime() + 3600 * 1000; t < now; t += 3600 * 1000) {
    const d = new Date(t);
    if (d.getHours() % 6 !== 0) continue;
    ticks.push({
      pos: ((t - start) / (CHART_HOURS * 3600 * 1000)) * 100,
      label: d.toLocaleTimeString(undefined, { hour: "numeric" }),
    });
  }

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-32 w-full" aria-hidden>
        <path d={`M${path(usage)} L${w} ${h} L0 ${h}Z`} fill={USAGE} opacity={0.18} />
        <path d={`M${path(usage)}`} fill="none" stroke={USAGE} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {solar && (
          <path d={`M${path(solar)}`} fill="none" stroke={SOLAR} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="relative mt-1 h-4 text-[11px] text-text-dim">
        {ticks.map((t) => (
          <span key={t.label + t.pos} className="absolute -translate-x-1/2" style={{ left: `${t.pos}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <div className="mt-1 flex gap-4 text-xs text-text-dim">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: USAGE }} /> Usage
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: SOLAR }} /> Solar
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-chip px-3.5 py-3">
      <div className="text-xs text-text-dim">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-text">{value}</div>
      {sub && <div className="text-xs text-text-dim">{sub}</div>}
    </div>
  );
}

export function PowerModal({ onClose }: { onClose: () => void }) {
  const { entities } = useHa();
  const now = useNow(60_000);
  const usageHistory = useEntityHistory(CURATED_ENERGY.consumption, CHART_HOURS, CHART_BUCKETS);
  const solarHistory = useEntityHistory(CURATED_ENERGY.production, CHART_HOURS, CHART_BUCKETS);

  const usage = num(entities, CURATED_ENERGY.consumption);
  // Sense reports a few negative watts of inverter standby at night.
  const solar = Math.max(0, num(entities, CURATED_ENERGY.production) ?? 0);
  const grid = usage === null ? null : usage - solar;
  const devices = senseDevices(entities);
  const price = useEnergyPrice();
  const cost = energyCost(entities, price, now);
  const running = devices.filter((d) => d.power >= 5);
  const co2 = num(entities, "sensor.electricity_maps_co2_intensity");
  const fossil = num(entities, "sensor.electricity_maps_grid_fossil_fuel_percentage");
  const v1 = num(entities, `${SENSE}_l1_voltage`);
  const v2 = num(entities, `${SENSE}_l2_voltage`);

  return (
    <Sheet
      title="Power"
      subtitle={
        grid === null
          ? "—"
          : grid >= 0
            ? `Pulling ${watts(grid)} from the grid`
            : `Sending ${watts(-grid)} back to the grid`
      }
      onClose={onClose}
    >
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-chip py-3">
          <Zap size={18} style={{ color: USAGE }} />
          <div className="text-lg font-semibold tabular-nums text-text">{watts(usage)}</div>
          <div className="text-xs text-text-dim">Using</div>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-chip py-3">
          <Sun size={18} style={{ color: SOLAR }} />
          <div className="text-lg font-semibold tabular-nums text-text">{watts(solar)}</div>
          <div className="text-xs text-text-dim">Solar</div>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-chip py-3">
          {grid !== null && grid < 0 ? (
            <ArrowUpRight size={18} style={{ color: SOLAR }} />
          ) : (
            <ArrowDownLeft size={18} className="text-text-dim" />
          )}
          <div className="text-lg font-semibold tabular-nums text-text">{watts(grid === null ? null : Math.abs(grid))}</div>
          <div className="text-xs text-text-dim">{grid !== null && grid < 0 ? "To grid" : "From grid"}</div>
        </div>
      </div>

      <SheetSection title="Last 24 hours">
        {usageHistory ? (
          <PowerChart
            now={now.getTime()}
            usage={usageHistory}
            solar={solarHistory ? solarHistory.map((v) => Math.max(0, v)) : null}
          />
        ) : (
          <div className="h-32 animate-pulse rounded-2xl bg-chip" />
        )}
      </SheetSection>

      <SheetSection title="Today">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Used" value={kwh(num(entities, `${SENSE}_daily_energy`))} />
          <Stat label="Solar made" value={kwh(num(entities, `${SENSE}_daily_production`))} />
          <Stat label="From grid" value={kwh(num(entities, `${SENSE}_daily_from_grid`))} />
          <Stat label="To grid" value={kwh(num(entities, `${SENSE}_daily_to_grid`))} />
        </div>
      </SheetSection>

      {price !== null && (
        <SheetSection title={`Cost · ${"$"}${price.toFixed(2)}/kWh`}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Today" value={money(cost.today)} sub="from the grid" />
            <Stat label="This month" value={money(cost.month)} sub={cost.projected !== null ? `on track for ${money(cost.projected)}` : undefined} />
            <Stat label="Solar saved" value={money(cost.solarSaved)} sub="this month" />
          </div>
        </SheetSection>
      )}

      <SheetSection title="This month">
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Used"
            value={kwh(num(entities, `${SENSE}_monthly_energy`))}
            sub={`${kwh(num(entities, `${SENSE}_monthly_from_grid`))} from grid`}
          />
          <Stat
            label="Solar made"
            value={kwh(num(entities, `${SENSE}_monthly_production`))}
            sub={`${kwh(num(entities, `${SENSE}_monthly_to_grid`))} sent back`}
          />
        </div>
      </SheetSection>

      {devices.length > 0 && (
        <SheetSection title={running.length > 0 ? "Using power now" : "Devices (all idle)"}>
          <div className="flex flex-col gap-2.5">
            {(running.length > 0 ? running : devices).map((d) => (
              <div key={d.name} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-medium text-text">{d.name}</span>
                  <span className="tabular-nums text-text-dim">
                    <span className="font-semibold text-text">{watts(d.power)}</span>
                    {d.today !== null && ` · ${d.today.toFixed(1)} kWh today`}
                  </span>
                </div>
                {usage !== null && usage > 0 && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-text-dim/20">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, (d.power / usage) * 100)}%`, background: USAGE }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-text-dim">Appliances as detected by Sense.</p>
        </SheetSection>
      )}

      {(co2 !== null || v1 !== null) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-xs text-text-dim">
          {co2 !== null && (
            <span>
              Grid carbon <b className="text-text">{Math.round(co2)} g/kWh</b>
              {fossil !== null && ` · ${Math.round(fossil)}% fossil`}
            </span>
          )}
          {v1 !== null && (
            <span>
              Voltage <b className="text-text">{v1.toFixed(0)} V / {v2?.toFixed(0) ?? "—"} V</b>
            </span>
          )}
        </div>
      )}
    </Sheet>
  );
}
