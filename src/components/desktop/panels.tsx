import {
  DoorClosed,
  DoorOpen,
  Download,
  Globe,
  HeartPulse,
  Leaf,
  Monitor,
  Power,
  Shield,
  ShieldAlert,
  Thermometer,
  Upload,
  Wifi,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { HassEntities } from "home-assistant-js-websocket";
import { CURATED_COMPUTERS, type CuratedComputer } from "../../config/computers";
import {
  CURATED_CLIMATE_ENTITY,
  CURATED_DOOR_SENSORS,
  CURATED_ENERGY,
  CURATED_VACUUM,
} from "../../config/curatedHome";
import {
  DESKTOP_ALARM,
  DESKTOP_APPLIANCES,
  DESKTOP_INDOOR,
  DESKTOP_NETWORK,
  DESKTOP_SAFETY,
  DESKTOP_WINDOWS,
  LOW_BATTERY_PCT,
} from "../../config/desktop";
import { useHa } from "../../ha/HaProvider";
import { roomColorFor } from "../../lib/roomPalette";
import { useNow } from "../../lib/useNow";
import { useOnNow } from "../home/OnNowModal";
import { Sparkline } from "../home/Sparkline";
import { HVAC_STYLES, powerParts } from "../home/statusIcons";
import { useEntityHistory } from "../home/useEntityHistory";
import { TrendChart } from "./TrendChart";
import { ALERT, DANGER, duration, isLive, KpiTile, Meter, num, OK, Panel, Row } from "./widgets";

/** The Sense monitor's own sensors share this prefix. */
const SENSE = CURATED_ENERGY.consumption.replace(/_energy$/, "");
const POWER = roomColorFor(4).accent;
const SOLAR = "#2f9e6f";
const DOWN = "#4f79c9";
const UP = "#7c5fc4";

/** KiB/s (UPnP) -> megabits per second. */
const mbps = (kib: number | null) => (kib === null ? null : (kib * 1024 * 8) / 1e6);
const fmtMbps = (v: number | null) => (v === null ? "—" : v >= 100 ? v.toFixed(0) : v.toFixed(1));

const kwh = (v: number | null) => (v === null ? "—" : v.toFixed(1));

/** Doors and windows that are open right now. */
export function useOpenings() {
  const { entities } = useHa();
  const all = [...CURATED_DOOR_SENSORS, ...DESKTOP_WINDOWS].filter((d) => entities[d.entityId]);
  const open = all.filter((d) => entities[d.entityId]?.state === "on");
  return { all, open };
}

/** Is a computer up right now (same rule as ComputerCard)? */
export function computerOnline(c: CuratedComputer, entities: HassEntities) {
  if (c.activity) return entities[c.activity.entityId]?.state === "on";
  return isLive(entities[c.onlineEntity]) && (!c.pingEntity || entities[c.pingEntity]?.state !== "off");
}

/** Everything in the House health panel that needs attention. */
export function useHealthIssues() {
  const { entities } = useHa();
  const issues: { label: string; detail: string; severity: "warn" | "danger" }[] = [];

  for (const s of DESKTOP_SAFETY) {
    if (entities[s.entityId]?.state === "on") issues.push({ label: s.label, detail: "Detected", severity: "danger" });
  }
  const alarm = entities[DESKTOP_ALARM]?.state;
  if (alarm === "triggered") issues.push({ label: "Alarm", detail: "Triggered", severity: "danger" });
  for (const a of DESKTOP_APPLIANCES) {
    if (a.kind === "problem" && entities[a.entityId]?.state === "on") {
      issues.push({ label: a.label, detail: "Needs attention", severity: "warn" });
    }
  }
  const updates = Object.values(entities).filter((e) => e.entity_id.startsWith("update.") && e.state === "on");
  if (updates.length) {
    issues.push({ label: "Updates", detail: `${updates.length} available`, severity: "warn" });
  }
  const low = lowBatteries(entities);
  if (low.length) issues.push({ label: "Batteries", detail: `${low.length} low`, severity: "warn" });
  if (entities[DESKTOP_NETWORK.wan]?.state === "off") {
    issues.push({ label: "Internet", detail: "Down", severity: "danger" });
  }
  return { issues, updates, low };
}

function lowBatteries(entities: HassEntities) {
  return Object.values(entities)
    .filter(
      (e) =>
        e.entity_id.startsWith("sensor.") &&
        e.attributes.device_class === "battery" &&
        e.attributes.unit_of_measurement === "%",
    )
    .map((e) => ({ e, v: num(e) }))
    .filter((x): x is { e: typeof x.e; v: number } => x.v !== null && x.v <= LOW_BATTERY_PCT)
    .sort((a, b) => a.v - b.v);
}

/** The Overview's row of headline numbers; each opens the page with more. */
export function KpiStrip() {
  const { entities } = useHa();
  const navigate = useNavigate();
  const history = useEntityHistory(CURATED_ENERGY.consumption);
  const downHistory = useEntityHistory(DESKTOP_NETWORK.down);
  const { items, indoor, away } = useOnNow();
  const { open, all } = useOpenings();
  const { issues } = useHealthIssues();

  const consumption = entities[CURATED_ENERGY.consumption];
  const power = consumption
    ? powerParts(consumption.state, consumption.attributes.unit_of_measurement as string | undefined)
    : null;
  const solarNow = Math.max(0, num(entities[CURATED_ENERGY.production]) ?? 0);
  const usedToday = num(entities[`${SENSE}_daily_energy`]);
  const madeToday = num(entities[`${SENSE}_daily_production`]);
  const fromGrid = num(entities[`${SENSE}_daily_from_grid`]);

  const climate = entities[CURATED_CLIMATE_ENTITY];
  const inside = num(entities[DESKTOP_INDOOR.temperature]) ?? (climate?.attributes.current_temperature as number | undefined) ?? null;
  const humidity = num(entities[DESKTOP_INDOOR.humidity]) ?? (climate?.attributes.current_humidity as number | undefined) ?? null;
  const mode = climate?.state;
  const target = climate?.attributes.temperature as number | undefined;
  const ModeIcon = (mode && HVAC_STYLES[mode]?.icon) || Thermometer;
  const action = climate?.attributes.hvac_action as string | undefined;

  const wanDown = entities[DESKTOP_NETWORK.wan]?.state === "off";
  const down = mbps(num(entities[DESKTOP_NETWORK.down]));
  const up = mbps(num(entities[DESKTOP_NETWORK.up]));

  const alarm = entities[DESKTOP_ALARM];
  const leftOn = away && indoor.length > 0;
  const danger = issues.some((i) => i.severity === "danger");

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
      <KpiTile
        icon={Zap}
        label="Power now"
        color={POWER}
        value={power ? power.value.toFixed(power.decimals) : "—"}
        unit={power?.unit}
        detail={solarNow > 0 ? `Solar ${Math.round(solarNow)} W` : "No solar right now"}
        footer={history && <Sparkline values={history} color={POWER} />}
        onOpen={() => navigate("/desktop/energy")}
        delay={40}
      />
      <KpiTile
        icon={Leaf}
        label="Energy today"
        color={SOLAR}
        value={kwh(usedToday)}
        unit="kWh"
        detail={`${kwh(madeToday)} made · ${kwh(fromGrid)} from grid`}
        footer={
          usedToday !== null && madeToday !== null && usedToday > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-text-dim/20">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (madeToday / usedToday) * 100)}%`, background: SOLAR }} />
              </div>
              <span className="text-[11px] text-text-dim">{Math.round(Math.min(100, (madeToday / usedToday) * 100))}% covered by solar</span>
            </div>
          ) : undefined
        }
        onOpen={() => navigate("/desktop/energy")}
        delay={70}
      />
      <KpiTile
        icon={ModeIcon}
        label="Indoor"
        color={roomColorFor(5).accent}
        value={inside === null ? "—" : `${Math.round(inside)}°`}
        unit={humidity === null ? undefined : `${Math.round(humidity)}% RH`}
        detail={
          mode ? (
            <span className="capitalize">
              {mode.replace(/_/g, " ")}
              {mode !== "off" && target !== undefined && ` to ${target}°`}
              {action && mode !== "off" && ` · ${action}`}
            </span>
          ) : undefined
        }
        onOpen={() => navigate("/desktop/energy")}
        delay={100}
      />
      <KpiTile
        icon={open.length ? DoorOpen : DoorClosed}
        label="Doors & windows"
        color={roomColorFor(1).accent}
        alert={open.length > 0}
        value={open.length ? `${open.length} open` : "Closed"}
        detail={open.length ? open.map((o) => o.label).join(", ") : `All ${all.length} closed`}
        onOpen={() => navigate("/desktop/security")}
        delay={130}
      />
      <KpiTile
        icon={Power}
        label="On right now"
        color={roomColorFor(0).accent}
        alert={leftOn}
        value={items.length ? `${items.length}` : "0"}
        unit={items.length === 1 ? "thing on" : "things on"}
        detail={leftOn ? "Nobody's home" : `${indoor.length} indoors · ${items.length - indoor.length} outside`}
        onOpen={() => navigate("/desktop/rooms")}
        delay={160}
      />
      <KpiTile
        icon={wanDown ? Globe : Wifi}
        label="Internet"
        color={DOWN}
        alert={wanDown}
        value={wanDown ? "Down" : fmtMbps(down)}
        unit={wanDown ? undefined : "Mbps"}
        detail={wanDown ? "WAN disconnected" : `↑ ${fmtMbps(up)} Mbps up`}
        footer={downHistory && <Sparkline values={downHistory} color={DOWN} />}
        onOpen={() => navigate("/desktop/devices")}
        delay={190}
      />
      <KpiTile
        icon={alarm?.state === "triggered" ? ShieldAlert : Shield}
        label="Alarm"
        color={roomColorFor(3).accent}
        alert={alarm?.state === "triggered"}
        value={<span className="capitalize">{alarm ? alarm.state.replace(/_/g, " ").replace(/^armed /, "") : "—"}</span>}
        detail={alarm?.state.startsWith("armed") ? "Armed" : alarm ? "UniFi Protect" : "Not set up"}
        onOpen={() => navigate("/desktop/security")}
        delay={220}
      />
      <KpiTile
        icon={HeartPulse}
        label="House health"
        color={OK}
        alert={issues.length > 0}
        value={issues.length ? `${issues.length} ${issues.length === 1 ? "issue" : "issues"}` : "All good"}
        detail={issues.length ? issues.map((i) => `${i.label} ${i.detail.toLowerCase()}`).join(" · ") : "Nothing needs attention"}
        onOpen={danger ? () => navigate("/desktop/security") : undefined}
        delay={250}
      />
    </div>
  );
}

/** Safety, appliances, vacuum, updates and batteries in one list. */
export function HealthPanel({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const { updates, low } = useHealthIssues();
  const alarm = entities[DESKTOP_ALARM];
  const safety = DESKTOP_SAFETY.filter((s) => entities[s.entityId]);
  const tripped = safety.filter((s) => entities[s.entityId]?.state === "on");
  const vacuum = entities[`vacuum.${CURATED_VACUUM.prefix}`];
  const vacBattery = num(entities[`sensor.${CURATED_VACUUM.prefix}_battery`]);

  return (
    <Panel title="House health" icon={HeartPulse} color={OK} delay={delay}>
      <div className="flex flex-col">
        {alarm && (
          <Row
            label="Alarm"
            dot={alarm.state === "triggered" ? DANGER : alarm.state.startsWith("armed") ? OK : "#9aa1b5"}
            value={<span className="capitalize">{alarm.state.replace(/_/g, " ")}</span>}
          />
        )}
        {safety.length > 0 && (
          <Row
            label="Smoke & CO"
            dot={tripped.length ? DANGER : OK}
            value={tripped.length ? tripped.map((t) => t.label).join(", ") : "Clear"}
            strong={tripped.length ? DANGER : undefined}
          />
        )}
        {DESKTOP_APPLIANCES.map((a) => {
          const e = entities[a.entityId];
          if (!e) return null;
          if (a.kind === "problem") {
            const bad = e.state === "on";
            return <Row key={a.entityId} label={a.label} dot={bad ? ALERT : OK} value={bad ? "Replace" : "OK"} strong={bad ? ALERT : undefined} />;
          }
          const unit = (e.attributes.unit_of_measurement as string | undefined) ?? "";
          return (
            <Row
              key={a.entityId}
              label={a.label}
              value={isLive(e) ? `${a.kind === "temp" ? Math.round(parseFloat(e.state)) : e.state}${unit}` : "—"}
            />
          );
        })}
        {vacuum && (
          <Row
            label={CURATED_VACUUM.name}
            sub="Vacuum"
            value={
              <span className="capitalize">
                {vacuum.state.replace(/_/g, " ")}
                {vacBattery !== null && ` · ${Math.round(vacBattery)}%`}
              </span>
            }
          />
        )}
        <Row
          label="Updates"
          dot={updates.length ? ALERT : OK}
          value={updates.length ? `${updates.length} available` : "Up to date"}
          sub={updates.length ? updates.map((u) => (u.attributes.title as string) || (u.attributes.friendly_name as string)).join(", ") : undefined}
        />
        <Row
          label="Batteries"
          dot={low.length ? ALERT : OK}
          value={low.length ? `${low.length} at ${LOW_BATTERY_PCT}% or less` : "All fine"}
          sub={low.length ? low.map((b) => `${b.e.attributes.friendly_name ?? b.e.entity_id} ${Math.round(b.v)}%`).join(" · ") : undefined}
        />
      </div>
    </Panel>
  );
}

/** Internet status, live throughput and the last 6 hours of it. */
export function NetworkPanel({ delay = 0, hours = 6 }: { delay?: number; hours?: number }) {
  const { entities, entitiesWithArea } = useHa();
  const downH = useEntityHistory(DESKTOP_NETWORK.down, hours, 72);
  const upH = useEntityHistory(DESKTOP_NETWORK.up, hours, 72);
  const wan = entities[DESKTOP_NETWORK.wan];
  const modem = entities[DESKTOP_NETWORK.modem];
  const down = mbps(num(entities[DESKTOP_NETWORK.down]));
  const up = mbps(num(entities[DESKTOP_NETWORK.up]));

  const clients = Object.values(entitiesWithArea).filter(
    (e) => e.domain === "device_tracker" && e.platform === "unifi" && e.entity.state === "home",
  );
  const wired = clients.filter((c) => c.entity.attributes.is_wired).length;

  return (
    <Panel
      title="Network"
      icon={Globe}
      color={DOWN}
      delay={delay}
      right={
        wan && (
          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: wan.state === "off" ? DANGER : OK }}>
            <span className="h-2 w-2 rounded-full" style={{ background: wan.state === "off" ? DANGER : OK }} />
            {wan.state === "off" ? "Offline" : "Online"}
          </span>
        )
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-chip px-3 py-2.5">
          <div className="flex items-center gap-1 text-[11px] text-text-dim">
            <Download size={12} style={{ color: DOWN }} /> Down
          </div>
          <div className="text-lg font-semibold tabular-nums text-text">
            {fmtMbps(down)} <small className="text-xs font-medium text-text-dim">Mbps</small>
          </div>
        </div>
        <div className="rounded-2xl bg-chip px-3 py-2.5">
          <div className="flex items-center gap-1 text-[11px] text-text-dim">
            <Upload size={12} style={{ color: UP }} /> Up
          </div>
          <div className="text-lg font-semibold tabular-nums text-text">
            {fmtMbps(up)} <small className="text-xs font-medium text-text-dim">Mbps</small>
          </div>
        </div>
        <div className="rounded-2xl bg-chip px-3 py-2.5">
          <div className="flex items-center gap-1 text-[11px] text-text-dim">
            <Wifi size={12} /> Clients
          </div>
          <div className="text-lg font-semibold tabular-nums text-text">
            {clients.length} <small className="text-xs font-medium text-text-dim">{wired} wired</small>
          </div>
        </div>
      </div>
      <TrendChart
        hours={hours}
        height={90}
        floor={0}
        format={(v) => `${fmtMbps(v)} Mbps`}
        series={[
          ...(downH ? [{ label: "Down", values: downH.map((v) => mbps(v)!), color: DOWN, fill: true }] : []),
          ...(upH ? [{ label: "Up", values: upH.map((v) => mbps(v)!), color: UP }] : []),
        ]}
      />
      {modem && <div className="text-xs capitalize text-text-dim">Cable modem {modem.state.replace(/_/g, " ")}</div>}
    </Panel>
  );
}

/** Every computer at a glance: up or not, CPU and memory. Full cards are on
 * the Devices page. */
export function SystemsPanel({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const now = useNow(60_000);
  const navigate = useNavigate();

  return (
    <Panel
      title="Computers"
      icon={Monitor}
      color={roomColorFor(2).accent}
      delay={delay}
      right={
        <button onClick={() => navigate("/desktop/devices")} className="text-xs font-semibold text-text-dim hover:text-text">
          Details →
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {CURATED_COMPUTERS.map((c) => {
          const online = computerOnline(c, entities);
          const boot = c.facts.find((f) => f.format === "since");
          const bootT = boot ? new Date(entities[boot.entityId]?.state ?? "").getTime() : NaN;
          const meters = c.meters.slice(0, 2);
          return (
            <div key={c.key} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[13px]">
                <c.icon size={15} className="text-text-dim" />
                <span className="font-semibold text-text">{c.name}</span>
                <span className="truncate text-text-dim">{c.subtitle}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs font-semibold" style={{ color: online ? OK : "#9aa1b5" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: online ? OK : "#9aa1b5" }} />
                  {online
                    ? c.activity
                      ? c.activity.on
                      : Number.isFinite(bootT)
                        ? `Up ${duration(now.getTime() - bootT)}`
                        : "Online"
                    : c.activity
                      ? c.activity.off
                      : "Offline"}
                </span>
              </div>
              {(online || c.activity) && (
                <div className="grid grid-cols-2 gap-3">
                  {meters.map((m) => {
                    const e = entities[m.entityId];
                    const raw = m.attribute ? parseFloat(String(e?.attributes[m.attribute])) : num(e);
                    const v = raw === null || !Number.isFinite(raw) ? null : m.invert ? 100 - raw : raw;
                    return <Meter key={m.entityId} label={m.label} value={v} invertWarn={m.lowIsBad} />;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Indoor temperature and humidity over the last day. */
export function IndoorPanel({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const temp = useEntityHistory(DESKTOP_INDOOR.temperature, 24, 96);
  const humidity = useEntityHistory(DESKTOP_INDOOR.humidity, 24, 96);
  const t = num(entities[DESKTOP_INDOOR.temperature]);
  const h = num(entities[DESKTOP_INDOOR.humidity]);
  const unit = (entities[DESKTOP_INDOOR.temperature]?.attributes.unit_of_measurement as string | undefined) ?? "°";

  return (
    <Panel
      title="Indoor · last 24 hours"
      icon={Thermometer}
      color={roomColorFor(5).accent}
      delay={delay}
      right={
        <span className="text-xs tabular-nums text-text-dim">
          {t !== null && <b className="text-text">{t.toFixed(1)}{unit}</b>}
          {h !== null && ` · ${Math.round(h)}% humidity`}
        </span>
      }
    >
      <div className="text-xs font-semibold text-text-dim">Temperature</div>
      <TrendChart hours={24} height={110} decimals={1} unit={unit} series={temp ? [{ label: "Temperature", values: temp, color: roomColorFor(5).accent, fill: true }] : []} />
      <div className="text-xs font-semibold text-text-dim">Humidity</div>
      <TrendChart hours={24} height={90} unit="%" series={humidity ? [{ label: "Humidity", values: humidity, color: "#3097a9", fill: true }] : []} />
    </Panel>
  );
}

/** Usage vs solar over the last 7 days, hourly. */
export function WeekPowerPanel({ delay = 0 }: { delay?: number }) {
  const usage = useEntityHistory(CURATED_ENERGY.consumption, 168, 168);
  const solar = useEntityHistory(CURATED_ENERGY.production, 168, 168);
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${Math.round(v)} W`);
  const avg = usage ? usage.reduce((a, b) => a + b, 0) / usage.length : null;
  const peak = usage ? Math.max(...usage) : null;

  return (
    <Panel
      title="Power · last 7 days"
      icon={Zap}
      color={POWER}
      delay={delay}
      right={
        avg !== null &&
        peak !== null && (
          <span className="text-xs tabular-nums text-text-dim">
            avg <b className="text-text">{fmt(avg)}</b> · peak <b className="text-text">{fmt(peak)}</b>
          </span>
        )
      }
    >
      <TrendChart
        hours={168}
        height={150}
        floor={0}
        format={fmt}
        series={[
          ...(usage ? [{ label: "Usage", values: usage, color: POWER, fill: true }] : []),
          ...(solar ? [{ label: "Solar", values: solar.map((v) => Math.max(0, v)), color: SOLAR }] : []),
        ]}
      />
    </Panel>
  );
}

/** Windows, the alarm and smoke/CO — the Security page's companion to the
 * Doors log. */
export function OpeningsPanel({ delay = 0 }: { delay?: number }) {
  const { entities } = useHa();
  const now = useNow(30_000);
  const windows = DESKTOP_WINDOWS.filter((w) => entities[w.entityId]);
  const alarm = entities[DESKTOP_ALARM];
  const safety = DESKTOP_SAFETY.filter((s) => entities[s.entityId]);

  return (
    <Panel title="Windows & safety" icon={Shield} color={roomColorFor(3).accent} delay={delay}>
      <div className="flex flex-col">
        {windows.map((w) => {
          const e = entities[w.entityId]!;
          const open = e.state === "on";
          const dead = !isLive(e);
          return (
            <Row
              key={w.entityId}
              label={w.label}
              dot={dead ? "#9aa1b5" : open ? ALERT : OK}
              value={dead ? "No signal" : open ? `Open ${duration(now.getTime() - new Date(e.last_changed).getTime())}` : "Closed"}
              strong={open ? ALERT : undefined}
            />
          );
        })}
        {alarm && (
          <Row
            label="Alarm"
            sub={`Since ${new Date(alarm.last_changed).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`}
            dot={alarm.state === "triggered" ? DANGER : alarm.state.startsWith("armed") ? OK : "#9aa1b5"}
            value={<span className="capitalize">{alarm.state.replace(/_/g, " ")}</span>}
          />
        )}
        {safety.map((s) => {
          const on = entities[s.entityId]?.state === "on";
          return <Row key={s.entityId} label={s.label} dot={on ? DANGER : OK} value={on ? "Detected" : "Clear"} strong={on ? DANGER : undefined} />;
        })}
      </div>
    </Panel>
  );
}

