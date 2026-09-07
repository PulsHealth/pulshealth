import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Distance } from "@/components/Distance";
import { WorkoutIcon, ChevronRight } from "@/components/Icons";
import { formatActivity } from "@/lib/activity";
import { GROUP_COLOR } from "@/lib/colors";
import { getWorkouts } from "@/lib/queries";
import { formatCompact, formatDuration, formatFull } from "@/lib/format";

// Always render live from the DB — no build-time demo snapshot, no stale cache.
export const dynamic = "force-dynamic";
export const metadata = { title: "Workouts — PulsHealth" };

export default async function WorkoutsPage() {
  const workouts = await getWorkouts(120);
  const color = GROUP_COLOR.workouts;

  const totalDur = workouts.reduce((s, w) => s + w.durationS, 0);
  const totalEnergy = workouts.reduce((s, w) => s + (w.energyKcal ?? 0), 0);
  const totalDist = workouts.reduce((s, w) => s + (w.distanceM ?? 0), 0);

  const summary: { label: string; value: React.ReactNode }[] = [
    { label: "Sessions", value: `${workouts.length}` },
    { label: "Total time", value: formatDuration(totalDur) },
    { label: "Energy", value: `${formatCompact(totalEnergy)} Cal` },
    { label: "Distance", value: <Distance meters={totalDist} /> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Workouts"
        accent={color}
        title="Workouts"
        subtitle="Latest 120 logged training sessions, newest first. Summary totals cover this list."
      />

      <div className="rise" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 22 }}>
        {summary.map((s) => (
          <div key={s.label} className="panel panel-tight" style={{ padding: "14px 16px" }}>
            <div className="eyebrow" style={{ fontSize: 10 }}>{s.label}</div>
            <div className="metric-num" style={{ fontSize: 24, fontWeight: 600, marginTop: 8 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="panel rise" style={{ overflow: "hidden", animationDelay: "60ms" }}>
        {workouts.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No workouts recorded yet.</div>
        )}
        {workouts.map((w, i) => (
          <Link
            key={w.uuid}
            href={`/workouts/${encodeURIComponent(w.uuid)}`}
            className="row-link"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "16px 20px",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              color: "inherit",
            }}
          >
            <span style={{ width: 38, height: 38, borderRadius: 11, flex: "none", display: "grid", placeItems: "center", background: `${color}1a`, color }}>
              <WorkoutIcon size={19} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 550 }}>{formatActivity(w.activityType)}</div>
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>{formatFull(w.start)}</div>
            </div>
            <div className="mono tabular" style={{ display: "flex", gap: 22, color: "var(--fg-soft)", fontSize: 13, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <span style={{ minWidth: 64, textAlign: "right" }}>{formatDuration(w.durationS)}</span>
              {w.energyKcal != null && <span style={{ minWidth: 70, textAlign: "right" }}>{formatCompact(w.energyKcal)} Cal</span>}
              {w.distanceM != null && <span style={{ minWidth: 78, textAlign: "right" }}><Distance meters={w.distanceM} /></span>}
            </div>
            <ChevronRight size={16} />
          </Link>
        ))}
      </div>
    </>
  );
}
