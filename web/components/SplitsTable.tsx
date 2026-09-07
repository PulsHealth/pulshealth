"use client";

// Per-km / per-mile splits table with a relative pace bar, Apple-Fitness style.
// Unit follows the viewer's metric/imperial preference.

import { useUnits } from "./UnitsProvider";
import { fmtPace, distanceUnit, fmtDistance } from "@/lib/units";
import { splitsFromRoute } from "@/lib/splits";
import type { RoutePoint } from "@/lib/types";

const M_PER_MI = 1609.344;

export function SplitsTable({ route, color }: { route: RoutePoint[]; color: string }) {
  const { system } = useUnits();
  const unitMeters = system === "imperial" ? M_PER_MI : 1000;
  const splits = splitsFromRoute(route, unitMeters);
  if (splits.length < 1) return null;

  // Fastest full split sets the bar scale (lower pace = faster = longer bar).
  const fulls = splits.filter((s) => !s.partial && s.paceMps > 0);
  const fastest = fulls.length ? Math.max(...fulls.map((s) => s.paceMps)) : 1;

  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 84px", gap: 12, padding: "10px 18px", fontSize: 10.5, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        <span>{distanceUnit(system)}</span>
        <span>Pace</span>
        <span style={{ textAlign: "right" }}>Time</span>
      </div>
      {splits.map((s) => {
        const widthPct = s.paceMps > 0 ? Math.min(100, (s.paceMps / fastest) * 100) : 0;
        const roundedSeconds = Math.round(s.seconds);
        const mins = Math.floor(roundedSeconds / 60);
        const secs = roundedSeconds % 60;
        return (
          <div key={s.index} style={{ display: "grid", gridTemplateColumns: "44px 1fr 84px", gap: 12, alignItems: "center", padding: "9px 18px", borderTop: "1px solid var(--border)", fontSize: 13 }}>
            <span className="tabular" style={{ color: "var(--fg-soft)" }}>
              {s.partial ? fmtDistance(s.distanceM, system) : s.index}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ position: "relative", flex: 1, height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, width: `${widthPct}%`, background: color, opacity: 0.8, borderRadius: 4 }} />
              </div>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)", minWidth: 64, textAlign: "right" }}>
                {fmtPace(s.paceMps, system)}
              </span>
            </div>
            <span className="mono tabular" style={{ textAlign: "right", color: "var(--fg-soft)" }}>
              {mins}:{secs.toString().padStart(2, "0")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
