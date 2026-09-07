"use client";

// Settings: the view-only metric/imperial toggle (persisted in localStorage) and
// a read-only summary of the synced profile + the heart-rate zones it implies.

import { useUnits } from "./UnitsProvider";
import type { UnitSystem } from "@/lib/units";
import { hrZones, type HrZone } from "@/lib/zones";
import type { Profile } from "@/lib/types";

export function SettingsView({ profile }: { profile: Profile }) {
  const { system, setSystem } = useUnits();
  const zones = hrZones(profile.maxHr, profile.restingHr);

  return (
    <>
      <section style={{ marginTop: 8 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Workout units</div>
        <div className="panel" style={{ padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 550 }}>Distance measurement system</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
              Controls workout distance, pace, speed, splits, and elevation. Data stays metric. Saved on this device.
            </div>
          </div>
          <div style={{ display: "inline-flex", background: "var(--border)", borderRadius: 9, padding: 3 }}>
            {(["metric", "imperial"] as UnitSystem[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={system === s}
                onClick={() => setSystem(s)}
                style={{
                  cursor: "pointer",
                  border: "none",
                  borderRadius: 7,
                  padding: "7px 16px",
                  fontSize: 13,
                  fontWeight: 550,
                  textTransform: "capitalize",
                  background: system === s ? "var(--panel)" : "transparent",
                  color: system === s ? "var(--fg)" : "var(--muted)",
                  boxShadow: system === s ? "0 1px 3px rgba(0,0,0,0.25)" : "none",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Profile</div>
        <div className="panel" style={{ overflow: "hidden" }}>
          <Row label="Age" value={profile.age != null ? `${profile.age}` : "Not synced"} first />
          <Row label="Biological sex" value={profile.biologicalSex ? cap(profile.biologicalSex) : "Not synced"} />
          <Row label="Max heart rate" value={`${profile.maxHr} bpm${profile.age == null ? " (default)" : ""}`} />
          <Row label="Resting heart rate" value={profile.restingHr != null ? `${Math.round(profile.restingHr)} bpm` : "Not synced"} />
        </div>
        <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 8 }}>
          Heart-rate zones use Heart Rate Reserve: resting HR + a percentage of max HR minus resting HR.
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Heart-rate zones</div>
        <div className="panel" style={{ overflow: "hidden" }}>
          {zones.slice().reverse().map((z, i) => (
            <div key={z.index} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "12px 18px", borderTop: i === 0 ? "none" : "1px solid var(--border)", fontSize: 13.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: z.color }} />
                <span style={{ fontWeight: 550 }}>Zone {z.index}</span>
                {z.loPct != null && <span style={{ color: "var(--faint)", fontSize: 12 }}>{z.loPct}%+</span>}
              </div>
              <span className="mono" style={{ color: "var(--fg-soft)" }}>
                {formatZoneRange(z)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function formatZoneRange(zone: HrZone): string {
  if (zone.loBpm == null && zone.hiBpm != null) return `<${zone.hiBpm} bpm`;
  if (zone.hiBpm == null && zone.loBpm != null) return `${zone.loBpm}+ bpm`;
  if (zone.loBpm != null && zone.hiBpm != null) return `${zone.loBpm}–${zone.hiBpm} bpm`;
  return "All bpm";
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function Row({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "12px 18px", borderTop: first ? "none" : "1px solid var(--border)", fontSize: 13.5 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ color: "var(--fg-soft)" }}>{value}</span>
    </div>
  );
}
