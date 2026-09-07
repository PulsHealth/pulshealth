// Time-in-heart-rate-zone breakdown, Apple-Fitness style: one horizontal bar per
// zone, length proportional to time spent, with the bpm range and duration.

import { formatDuration } from "@/lib/format";
import { hrZones, type HrZone } from "@/lib/zones";

export function ZoneBar({ secondsByZone, maxHr, restingHr }: { secondsByZone: number[]; maxHr: number; restingHr: number | null }) {
  const zones = hrZones(maxHr, restingHr);
  const total = secondsByZone.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const maxSec = Math.max(...secondsByZone, 1);

  return (
    <div className="panel" style={{ padding: "16px 18px", display: "grid", gap: 10 }}>
      {zones
        .map((z, i) => ({ z, secs: secondsByZone[i] }))
        .reverse() // Z5 at the top, like Apple
        .map(({ z, secs }) => (
          <Row key={z.index} zone={z} secs={secs} widthPct={(secs / maxSec) * 100} pct={(secs / total) * 100} />
        ))}
    </div>
  );
}

function Row({ zone, secs, widthPct, pct }: { zone: HrZone; secs: number; widthPct: number; pct: number }) {
  const range = formatZoneRange(zone);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "64px 1fr 92px", alignItems: "center", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: zone.color }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Z{zone.index}</span>
      </div>
      <div style={{ position: "relative", height: 20, borderRadius: 5, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${Math.max(widthPct, secs > 0 ? 3 : 0)}%`, background: zone.color, opacity: 0.85, borderRadius: 5 }} />
      </div>
      <div style={{ textAlign: "right", fontSize: 11.5, color: "var(--muted)" }} className="tabular">
        <div className="mono" style={{ color: "var(--fg-soft)" }}>{formatDuration(secs)}</div>
        <div style={{ fontSize: 10, color: "var(--faint)" }}>{range} · {Math.round(pct)}%</div>
      </div>
    </div>
  );
}

function formatZoneRange(zone: HrZone): string {
  if (zone.loBpm == null && zone.hiBpm != null) return `<${zone.hiBpm} bpm`;
  if (zone.hiBpm == null && zone.loBpm != null) return `${zone.loBpm}+ bpm`;
  if (zone.loBpm != null && zone.hiBpm != null) return `${zone.loBpm}–${zone.hiBpm} bpm`;
  return "All bpm";
}
