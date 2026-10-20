import { useId, useRef, useState } from "react";
import clsx from "clsx";

// A 270° arc (like a classic Nest/thermostat dial) with a 90° gap centered
// at the bottom. Angle 0 points east; positive angles rotate clockwise
// (matches SVG's y-down coordinate space), so START_ANGLE=135 sits at the
// lower-left and the arc sweeps clockwise through the top to the lower-right.
const START_ANGLE = 135;
const SWEEP = 270;

interface DialHandle {
  value: number;
  color: string;
  onCommit: (value: number) => void;
}

export function RadialDial({
  min,
  max,
  step,
  handles,
  size = 260,
  trackColor = "var(--color-chip)",
  rangeFillColor = "var(--color-ok)",
  disabled,
  centerLabel,
}: {
  min: number;
  max: number;
  step: number;
  handles: DialHandle[];
  size?: number;
  trackColor?: string;
  rangeFillColor?: string;
  disabled?: boolean;
  centerLabel?: string;
}) {
  const shadowId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingIndexRef = useRef<number | null>(null);
  // Which handle the arrow keys move — Enter swaps it on a two-handle dial.
  const [keyIndex, setKeyIndex] = useState(0);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 28;
  const trackWidth = 14;
  const knobR = size * 0.055;

  function valueToAngle(value: number) {
    const t = clamp01((value - min) / (max - min));
    return START_ANGLE + t * SWEEP;
  }

  function angleFromPointer(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = (clientX - rect.left) * (size / rect.width);
    const y = (clientY - rect.top) * (size / rect.height);
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    let rel = deg - START_ANGLE;
    if (rel < 0) rel += 360;
    return { rel, dist };
  }

  function relToValue(rel: number) {
    const clamped = rel <= SWEEP ? rel : rel < SWEEP + (360 - SWEEP) / 2 ? SWEEP : 0;
    const t = clamped / SWEEP;
    const raw = min + t * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Number(clampNum(stepped, min, max).toFixed(2));
  }

  function commit(idx: number, rel: number) {
    let v = relToValue(rel);
    if (handles.length === 2) {
      if (idx === 0) v = Math.min(v, handles[1].value - step);
      else v = Math.max(v, handles[0].value + step);
      v = clampNum(v, min, max);
    }
    if (v !== handles[idx].value) handles[idx].onCommit(v);
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (disabled) return;
    const hit = angleFromPointer(e.clientX, e.clientY);
    if (!hit) return;
    // Only start a drag when the pointer lands near the ring/knob, not the
    // center readout — an accidental center tap shouldn't jump the target.
    if (Math.abs(hit.dist - r) > knobR + 16) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    const idx =
      handles.length > 1
        ? Math.abs(handles[0].value - relToValue(hit.rel)) <=
          Math.abs(handles[1].value - relToValue(hit.rel))
          ? 0
          : 1
        : 0;
    draggingIndexRef.current = idx;
    commit(idx, hit.rel);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (draggingIndexRef.current === null) return;
    const hit = angleFromPointer(e.clientX, e.clientY);
    if (!hit) return;
    commit(draggingIndexRef.current, hit.rel);
  }

  function handlePointerUp() {
    draggingIndexRef.current = null;
  }

  // Keyboard / TV remote: left and right nudge the active handle one step.
  function handleKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (disabled) return;
    const idx = Math.min(keyIndex, handles.length - 1);
    if (e.key === "Enter" && handles.length > 1) {
      e.preventDefault();
      e.stopPropagation();
      setKeyIndex(idx === 0 ? 1 : 0);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = handles[idx].value + (e.key === "ArrowRight" ? step : -step);
    commit(idx, ((clampNum(next, min, max) - min) / (max - min)) * SWEEP);
  }

  const trackPath = describeArc(cx, cy, r, START_ANGLE, START_ANGLE + SWEEP);

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={clsx(
        "touch-none select-none",
        disabled ? "opacity-50" : "cursor-grab active:cursor-grabbing",
      )}
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Target temperature"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={handles[Math.min(keyIndex, handles.length - 1)].value}
      onKeyDown={handleKeyDown}
    >
      <defs>
        <filter id={shadowId} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.28)" />
        </filter>
      </defs>

      <path
        d={trackPath}
        fill="none"
        stroke={trackColor}
        strokeWidth={trackWidth}
        strokeLinecap="round"
      />

      {handles.length === 1 &&
        (() => {
          const a1 = valueToAngle(handles[0].value);
          if (a1 - START_ANGLE < 0.5) return null;
          return (
            <path
              d={describeArc(cx, cy, r, START_ANGLE, a1)}
              fill="none"
              stroke={handles[0].color}
              strokeWidth={trackWidth}
              strokeLinecap="round"
            />
          );
        })()}

      {handles.length === 2 &&
        (() => {
          const aLow = valueToAngle(handles[0].value);
          const aHigh = valueToAngle(handles[1].value);
          if (aHigh - aLow < 0.5) return null;
          return (
            <path
              d={describeArc(cx, cy, r, aLow, aHigh)}
              fill="none"
              stroke={rangeFillColor}
              strokeWidth={trackWidth}
              strokeLinecap="round"
            />
          );
        })()}

      {handles.map((h, i) => {
        const angle = valueToAngle(h.value);
        const pos = polarToCartesian(cx, cy, r, angle);
        return (
          <circle
            key={i}
            cx={pos.x}
            cy={pos.y}
            r={knobR}
            fill="var(--color-surface)"
            stroke={h.color}
            strokeWidth={handles.length > 1 && i === keyIndex ? 6 : 4}
            filter={`url(#${shadowId})`}
          />
        );
      })}

      {handles.length === 1 ? (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: size * 0.19, fontWeight: 600 }}
          className="fill-text tabular-nums"
        >
          {handles[0].value}°
        </text>
      ) : (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: size * 0.13, fontWeight: 700 }}
          className="tabular-nums"
        >
          <tspan fill={handles[0].color}>{handles[0].value}°</tspan>
          <tspan fill="var(--color-text-dim)" style={{ fontSize: size * 0.08 }}>
            {" "}
            – {" "}
          </tspan>
          <tspan fill={handles[1].color}>{handles[1].value}°</tspan>
        </text>
      )}

      {centerLabel && (
        <text
          x={cx}
          y={cy + size * (handles.length === 1 ? 0.15 : 0.13)}
          textAnchor="middle"
          style={{ fontSize: size * 0.055, fontWeight: 500, letterSpacing: "0.04em" }}
          className="fill-text-dim uppercase"
        >
          {centerLabel}
        </text>
      )}
    </svg>
  );
}

function clamp01(t: number) {
  return Math.min(1, Math.max(0, t));
}

function clampNum(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}
