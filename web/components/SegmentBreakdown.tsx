// Per-activity breakdown for multi-sport / interval workouts (HKWorkoutActivity).
// One row per segment: activity type, duration, and its avg/max heart rate.

import { formatActivity } from "@/lib/activity";
import { formatDuration } from "@/lib/format";
import type { WorkoutActivitySegment } from "@/lib/types";

const HR = "HKQuantityTypeIdentifierHeartRate";
const ENERGY = "HKQuantityTypeIdentifierActiveEnergyBurned";

export function SegmentBreakdown({ activities }: { activities: WorkoutActivitySegment[] }) {
  if (activities.length < 1) return null;
  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      {activities.map((a, i) => {
        const hr = a.statistics[HR];
        const energy = a.statistics[ENERGY];
        const bits: string[] = [];
        if (hr?.avg != null) bits.push(`${Math.round(hr.avg)} bpm avg`);
        if (hr?.max != null) bits.push(`${Math.round(hr.max)} max`);
        if (energy?.sum != null) bits.push(`${Math.round(energy.sum)} Cal`);
        return (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", padding: "12px 18px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-soft)" }}>
                {i + 1}. {formatActivity(a.activityType)}
              </div>
              {bits.length > 0 && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 2 }}>{bits.join(" · ")}</div>}
            </div>
            <div className="mono tabular" style={{ fontSize: 13, color: "var(--muted)" }}>{formatDuration(a.durationS)}</div>
          </div>
        );
      })}
    </div>
  );
}
