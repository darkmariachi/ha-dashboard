import { createElement } from "react";
import { Droplets, Gauge, Sunrise, Sunset, Thermometer, Umbrella, Wind } from "lucide-react";
import { CURATED_WEATHER_ENTITY, HOUSEHOLD_NAME } from "../../config/curatedHome";
import { useHa } from "../../ha/HaProvider";
import { greetingFor } from "../../lib/greeting";
import { useNow } from "../../lib/useNow";
import { weatherIcon, weatherLabel } from "../home/statusIcons";
import { useWeatherForecast, type ForecastEntry } from "../home/useWeatherForecast";
import { WhoIsHome } from "../home/WhoIsHome";

type Forecast = ForecastEntry & { precipitation_probability?: number; precipitation?: number };

const round = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v)}°`);
const time = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";

function compass(deg: number | undefined) {
  if (deg === undefined) return "";
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

function Clock() {
  const now = useNow(1000);
  const h = now.getHours();
  return (
    <div>
      <div className="text-[84px] font-extralight leading-[0.9] tracking-[-3.5px] tabular-nums">
        {((h + 11) % 12) + 1}:{String(now.getMinutes()).padStart(2, "0")}
        <span className="ml-1 text-[22px] font-normal tracking-normal opacity-70">
          :{String(now.getSeconds()).padStart(2, "0")} {h < 12 ? "AM" : "PM"}
        </span>
      </div>
      <div className="mt-2 text-[20px] font-medium">
        {greetingFor(h)}, {HOUSEHOLD_NAME}
      </div>
      <div className="text-[14px] opacity-85">
        {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      </div>
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof Wind; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12.5px]">
      <Icon size={14} className="opacity-80" />
      <span className="opacity-75">{label}</span>
      <b className="font-semibold">{value}</b>
    </div>
  );
}

/**
 * The top of every desktop page's Overview: a seconds clock and greeting,
 * who's home, then everything the weather entity knows (feels-like, wind,
 * humidity, UV, pressure, sunrise/sunset), the next 12 hours and the week.
 * Sits on the weather photo, so white text.
 */
export function DesktopHeader() {
  const { entities } = useHa();
  const now = useNow(60_000);
  const weather = entities[CURATED_WEATHER_ENTITY];
  const sun = entities["sun.sun"];
  const hourly = useWeatherForecast(CURATED_WEATHER_ENTITY, "hourly") as Forecast[] | null;
  const daily = useWeatherForecast(CURATED_WEATHER_ENTITY, "daily") as Forecast[] | null;
  const a = weather?.attributes ?? {};
  const nextHours = (hourly ?? []).filter((f) => new Date(f.datetime).getTime() > now.getTime()).slice(0, 12);
  const week = (daily ?? []).slice(0, 7);
  const weekMin = Math.min(...week.map((d) => d.templow ?? d.temperature ?? 0));
  const weekMax = Math.max(...week.map((d) => d.temperature ?? 0));
  const today = week[0];

  const wind = a.wind_speed as number | undefined;
  const windUnit = (a.wind_speed_unit as string | undefined) ?? "";
  const pressure = a.pressure as number | undefined;
  const rainChance = nextHours.length ? Math.max(...nextHours.map((f) => f.precipitation_probability ?? 0)) : undefined;

  return (
    <header className="hero-shadow grid gap-6 text-white xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="rise flex flex-col justify-between gap-4">
        <Clock />
        <WhoIsHome size={40} />
      </div>

      {weather && (
        <div className="rise flex flex-col gap-3" style={{ animationDelay: "60ms" }}>
          <div className="flex items-center gap-4">
            {createElement(weatherIcon(weather.state), { size: 56, strokeWidth: 1.3 })}
            <div className="text-[64px] font-extralight leading-none tracking-[-2.5px]">
              {round(a.temperature as number | undefined)}
            </div>
            <div className="min-w-0 text-[13px] leading-snug">
              <div className="text-[18px] font-semibold">{weatherLabel(weather.state)}</div>
              {today && (
                <div className="opacity-90">
                  High {round(today.temperature)} · Low {round(today.templow)}
                </div>
              )}
              {a.apparent_temperature !== undefined && (
                <div className="opacity-90">Feels like {round(a.apparent_temperature as number)}</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {a.humidity !== undefined && <Detail icon={Droplets} label="Humidity" value={`${a.humidity}%`} />}
            {wind !== undefined && (
              <Detail icon={Wind} label="Wind" value={`${Math.round(wind)} ${windUnit} ${compass(a.wind_bearing as number | undefined)}`} />
            )}
            {a.uv_index !== undefined && <Detail icon={Thermometer} label="UV" value={String(a.uv_index)} />}
            {pressure !== undefined && (
              <Detail icon={Gauge} label="Pressure" value={`${Math.round(pressure)} ${(a.pressure_unit as string) ?? ""}`} />
            )}
            {rainChance !== undefined && rainChance > 0 && <Detail icon={Umbrella} label="Rain 12 h" value={`${rainChance}%`} />}
            {sun && <Detail icon={Sunrise} label="Sunrise" value={time(sun.attributes.next_rising as string)} />}
            {sun && <Detail icon={Sunset} label="Sunset" value={time(sun.attributes.next_setting as string)} />}
          </div>

          {nextHours.length > 0 && (
            <div className="flex justify-between gap-1 rounded-[18px] border border-white/25 bg-white/15 px-2 py-2 [text-shadow:none] backdrop-blur-md">
              {nextHours.map((f) => (
                <div key={f.datetime} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-[11px]">
                  <span className="opacity-85">{new Date(f.datetime).toLocaleTimeString(undefined, { hour: "numeric" })}</span>
                  {createElement(weatherIcon(f.condition), { size: 17 })}
                  <b className="text-[12.5px] font-semibold">{round(f.temperature)}</b>
                  <span className="h-3 text-[10px] text-[#bfe3ff]">
                    {f.precipitation_probability ? `${f.precipitation_probability}%` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {week.length > 0 && (
        <div
          className="rise flex flex-col gap-0.5 self-start rounded-[18px] border border-white/25 bg-white/15 px-3.5 py-2.5 [text-shadow:none] backdrop-blur-md"
          style={{ animationDelay: "120ms" }}
        >
          {week.map((d, i) => {
            const lo = d.templow ?? d.temperature ?? 0;
            const hi = d.temperature ?? lo;
            const span = weekMax - weekMin || 1;
            return (
              <div key={d.datetime} className="flex items-center gap-2.5 text-[12.5px]">
                <span className="w-10 font-semibold">
                  {i === 0 ? "Today" : new Date(d.datetime).toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                {createElement(weatherIcon(d.condition), { size: 16 })}
                <span className="w-8 text-[10.5px] text-[#bfe3ff]">
                  {d.precipitation_probability ? `${d.precipitation_probability}%` : ""}
                </span>
                <span className="w-8 text-right tabular-nums opacity-80">{round(d.templow)}</span>
                <div className="relative h-1.5 flex-1 rounded-full bg-white/20">
                  <div
                    className="absolute h-full rounded-full bg-gradient-to-r from-[#8fd3ff] to-[#ffcf6b]"
                    style={{ left: `${((lo - weekMin) / span) * 100}%`, right: `${100 - ((hi - weekMin) / span) * 100}%` }}
                  />
                </div>
                <span className="w-8 tabular-nums font-semibold">{round(d.temperature)}</span>
              </div>
            );
          })}
        </div>
      )}
    </header>
  );
}
