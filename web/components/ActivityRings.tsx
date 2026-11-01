"use client";

import { useUnits } from "./UnitsProvider";
import { convertMetric } from "@/lib/units";
import { displayUnit, formatCompact } from "@/lib/format";

function useDisplayRings(rings: RingDatum[]): RingDatum[] {
  const { preferences } = useUnits();
  return rings.map((ring) => {
    if (ring.unit !== "Cal") return ring;
    const converted = convertMetric("", ring.value, "kcal", preferences);
    return { ...ring, value: converted.value, goal: convertMetric("", ring.goal, "kcal", preferences).value, unit: displayUnit(converted.unit) };
  });
}

export function RingHighlights({ rings }: { rings: RingDatum[] }) {
  const displayRings = useDisplayRings(rings);
  return <>{displayRings.map((r) => (
    <div key={r.label}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span className="dot" style={{ background: r.color }} />
        <span className="eyebrow" style={{ color: "var(--muted)" }}>{r.label}</span>
      </div>
      <div className="metric-num" style={{ fontSize: 34, fontWeight: 600, marginTop: 8 }}>
        {formatCompact(r.value)}
        <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 400 }}> / {formatCompact(r.goal)}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>{r.unit}</div>
    </div>
  ))}</>;
}

export interface RingDatum {
  label: string;
  value: number;
  goal: number;
  unit: string;
  color: string;
}

// Apple-Health-style concentric progress rings.
export function ActivityRings({ rings, size = 188 }: { rings: RingDatum[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = size * 0.082;
  const gap = stroke * 0.42;
  const outer = cx - stroke / 2 - 2;
  const displayRings = useDisplayRings(rings);
  const label = displayRings.map((ring) => `${ring.label}: ${ring.value} of ${ring.goal} ${ring.unit}`).join(", ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="fadein" role="img" aria-label={label}>
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {rings.map((r, i) => {
          const radius = outer - i * (stroke + gap);
          const c = 2 * Math.PI * radius;
          const pct = Math.max(0, Math.min(1, r.goal > 0 ? r.value / r.goal : 0));
          const dash = c * pct;
          return (
            <g key={r.label}>
              <circle cx={cx} cy={cy} r={radius} fill="none" stroke={r.color} strokeOpacity={0.16} strokeWidth={stroke} />
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={r.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${c - dash}`}
                style={{ filter: `drop-shadow(0 0 6px ${r.color}66)` }}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
