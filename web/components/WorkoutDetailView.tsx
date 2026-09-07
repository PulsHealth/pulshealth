"use client";

// Everything below the page header on a workout detail page. Client-side so the
// metric/imperial unit toggle re-renders live; all values arrive canonical
// (metric) and are formatted per the viewer's preference.

import { RouteMap } from "./RouteMap";
import { RouteProfile } from "./RouteProfile";
import { SegmentBreakdown } from "./SegmentBreakdown";
import { SplitsTable } from "./SplitsTable";
import { TimeSeriesChart, type ZoneBand } from "./TimeSeriesChart";
import { ZoneBar } from "./ZoneBar";
import { useUnits } from "./UnitsProvider";
import { typeByIdentifier } from "@/lib/catalog";
import { GROUP_COLOR } from "@/lib/colors";
import { routeProfile, routeSummary } from "@/lib/geo";
import { formatCompact, formatDuration, formatFull } from "@/lib/format";
import { convertWorkoutMetric, fmtDistance, fmtElevation, fmtPace, fmtSpeed } from "@/lib/units";
import { hrZones, timeInZones } from "@/lib/zones";
import type { Profile, WorkoutDetail, WorkoutSeries } from "@/lib/types";

const HR = "HKQuantityTypeIdentifierHeartRate";
const CHART_COLORS = ["#bf5af2", "#ff9f0a", "#64d2ff", "#30d158", "#ff375f"];

function downsample<T>(points: T[], max = 300): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel panel-tight" style={{ padding: "14px 16px" }}>
      <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div className="metric-num tabular" style={{ fontSize: 22, fontWeight: 600, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>{title}</div>
      {children}
    </section>
  );
}

export function WorkoutDetailView({ w, series, profile }: { w: WorkoutDetail; series: WorkoutSeries[]; profile: Profile }) {
  const { system } = useUnits();
  const color = GROUP_COLOR.workouts;
  const summary = routeSummary(w.route);
  const profilePts = routeProfile(w.route);
  const hasRoute = w.route.length >= 2;
  const foot = /run|walk|hik/i.test(w.activityType);

  const distance = w.distanceM ?? (summary.distanceM > 0 ? summary.distanceM : null);
  const hrStat = w.statsDetail[HR];
  const hrAvg = hrStat?.avg ?? w.stats[HR] ?? null;

  // Headline cards.
  const cards: { label: string; value: string; sub?: string }[] = [
    { label: "Duration", value: formatDuration(w.durationS) },
  ];
  if (distance != null) cards.push({ label: "Distance", value: fmtDistance(distance, system) });
  if (w.energyKcal != null) cards.push({ label: "Active energy", value: `${formatCompact(w.energyKcal)} Cal` });
  if (summary.avgSpeedMps != null) {
    cards.push(foot
      ? { label: "Avg pace", value: fmtPace(summary.avgSpeedMps, system) }
      : { label: "Avg speed", value: fmtSpeed(summary.avgSpeedMps, system) });
  }
  if (summary.hasAltitude) {
    cards.push({
      label: "Elevation gain",
      value: fmtElevation(summary.elevGainM, system),
      sub: summary.maxAltM != null ? `peak ${fmtElevation(summary.maxAltM, system)}` : undefined,
    });
  }
  if (hrAvg != null) {
    cards.push({ label: "Avg heart rate", value: `${Math.round(hrAvg)} bpm`, sub: hrStat?.max != null ? `max ${Math.round(hrStat.max)} bpm` : undefined });
  }

  const hrSeries = series.find((s) => s.type === HR);
  const otherSeries = series.filter((s) => s.type !== HR && s.points.length >= 2);
  const lapMarkers = w.events.filter((e) => e.type === "lap" || e.type === "segment").map((e) => e.start);
  const zoneBands: ZoneBand[] = hrZones(profile.maxHr, profile.restingHr).map((z) => ({ lo: z.loBpm, hi: z.hiBpm, color: z.color }));
  const zoneSecs = hrSeries ? timeInZones(hrSeries.points, profile.maxHr, profile.restingHr) : [];

  const metaEntries = Object.entries(w.metadata ?? {});
  const statEntries = Object.entries(w.statsDetail ?? {});

  return (
    <>
      <div className="rise" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {cards.map((c) => <Stat key={c.label} label={c.label} value={c.value} sub={c.sub} />)}
      </div>

      {hasRoute && (
        <Section title="Route">
          <RouteMap route={w.route} color={color} />
        </Section>
      )}

      {hrSeries && hrSeries.points.length >= 2 && (
        <Section title="Heart rate">
          <div className="panel" style={{ padding: "16px 18px" }}>
            <TimeSeriesChart points={downsample(hrSeries.points)} startMs={w.start} color="#ff375f" unit="bpm" markers={lapMarkers} zoneBands={zoneBands} />
          </div>
        </Section>
      )}

      {zoneSecs.some((s) => s > 0) && (
        <Section title="Heart rate zones">
          <ZoneBar secondsByZone={zoneSecs} maxHr={profile.maxHr} restingHr={profile.restingHr} />
        </Section>
      )}

      {hasRoute && (
        <Section title="Splits">
          <SplitsTable route={w.route} color={color} />
        </Section>
      )}

      {otherSeries.map((s, i) => {
        const t = typeByIdentifier(s.type);
        const pts = downsample(s.points).map((p) => ({
          t: p.t,
          value: convertWorkoutMetric(s.type, p.value, s.unit, system).value,
        }));
        const unit = convertWorkoutMetric(s.type, 0, s.unit, system).unit ?? "";
        return (
          <Section key={s.type} title={t?.name ?? s.type}>
            <div className="panel" style={{ padding: "16px 18px" }}>
              <TimeSeriesChart points={pts} startMs={w.start} color={CHART_COLORS[i % CHART_COLORS.length]} unit={unit} markers={lapMarkers} />
            </div>
          </Section>
        );
      })}

      {hasRoute && summary.hasAltitude && (
        <Section title="Elevation">
          <div className="panel" style={{ padding: "16px 18px" }}>
            <RouteProfile points={profilePts} metric="altitude" color={color} system={system} />
          </div>
        </Section>
      )}

      {w.activities.length > 1 && (
        <Section title="Activities">
          <SegmentBreakdown activities={w.activities} />
        </Section>
      )}

      {statEntries.length > 0 && (
        <Section title="Metrics">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            {statEntries.map(([id, stat]) => {
              const t = typeByIdentifier(id);
              const primary = stat.avg ?? stat.sum ?? stat.max ?? stat.min;
              if (primary == null) return null;
              const converted = convertWorkoutMetric(id, primary, t?.unit ?? null, system);
              const unit = converted.unit ? ` ${converted.unit}` : "";
              const isDiscrete = stat.sum == null;
              let sub: string | undefined;
              if (isDiscrete && stat.min != null && stat.max != null) {
                const lo = convertWorkoutMetric(id, stat.min, t?.unit ?? null, system).value;
                const hi = convertWorkoutMetric(id, stat.max, t?.unit ?? null, system).value;
                sub = `${formatCompact(lo)}–${formatCompact(hi)}${unit}`;
              }
              return <Stat key={id} label={t?.name ?? id} value={`${formatCompact(converted.value)}${unit}`} sub={sub} />;
            })}
          </div>
        </Section>
      )}

      <Section title="Details">
        <div className="panel" style={{ overflow: "hidden" }}>
          <DetailRow label="Started" value={formatFull(w.start)} first />
          <DetailRow label="Ended" value={formatFull(w.end)} />
          {w.source && <DetailRow label="Source" value={w.source} />}
          {hasRoute && <DetailRow label="Route points" value={w.route.length.toLocaleString()} />}
          {hrSeries && <DetailRow label="HR samples" value={hrSeries.points.length.toLocaleString()} />}
          {metaEntries.map(([k, v]) => <DetailRow key={k} label={prettyKey(k)} value={metaValue(v)} />)}
          <DetailRow label="UUID" value={w.uuid} mono />
        </div>
      </Section>
    </>
  );
}

function prettyKey(key: string): string {
  const base = key.replace(/^HKMetadataKey/, "").replace(/^HK/, "");
  return base.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim() || key;
}

function metaValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" || typeof v === "string") return String(v);
  return JSON.stringify(v);
}

function DetailRow({ label, value, mono, first }: { label: string; value: string; mono?: boolean; first?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "12px 18px", borderTop: first ? "none" : "1px solid var(--border)", fontSize: 13.5 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span className={mono ? "mono" : undefined} style={{ color: "var(--fg-soft)", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}
