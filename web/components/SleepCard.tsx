import Link from "next/link";
import { totalSleepMinutes, type SleepDay } from "@/lib/sleep";
import { GROUP_COLOR } from "@/lib/colors";
import { Sparkline } from "./Sparkline";
import { ArrowDown, ArrowUp } from "./Icons";

const STAGES = [
  { key: "coreMinutes", label: "Core" },
  { key: "deepMinutes", label: "Deep" },
  { key: "remMinutes", label: "REM" },
] as const;

function hoursAndMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}

function pct(value: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
}

function trendDelta(values: number[]): number | null {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 4) return null;
  const half = Math.floor(clean.length / 2);
  const a = clean.slice(0, half).reduce((x, y) => x + y, 0) / half;
  const b = clean.slice(half).reduce((x, y) => x + y, 0) / (clean.length - half);
  return a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null;
}

export function SleepCard({
  sleep,
  history = [],
  compact = false,
}: {
  sleep: SleepDay | null;
  history?: SleepDay[];
  compact?: boolean;
}) {
  if (!sleep) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="dot" style={{ background: GROUP_COLOR.sleep }} />
          <span style={{ color: "var(--fg-soft)", fontSize: 13.5 }}>Sleep Duration</span>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          No sleep-stage data recorded.
        </div>
      </div>
    );
  }

  const asleep = totalSleepMinutes(sleep);

  if (compact) {
    const spark = history.slice().reverse().map(totalSleepMinutes);
    const delta = trendDelta(spark);

    return (
      <Link href="/type/HKCategoryTypeIdentifierSleepAnalysis" className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span className="dot" style={{ background: GROUP_COLOR.sleep }} />
            <span style={{ color: "var(--fg-soft)", fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Sleep Duration
            </span>
          </div>
          {delta != null && Math.abs(delta) >= 1 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                fontSize: 11.5,
                color: delta >= 0 ? "#30d158" : "#ff6b6b",
              }}
              className="mono"
            >
              {delta >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {Math.abs(delta).toFixed(0)}%
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 14 }}>
          <div className="metric-num" style={{ fontSize: 30, fontWeight: 600 }}>
            {hoursAndMinutes(asleep)}
          </div>
          <Sparkline values={spark} color={GROUP_COLOR.sleep} />
        </div>
      </Link>
    );
  }

  const rows = STAGES.map((stage) => ({ ...stage, minutes: sleep[stage.key] }));

  return (
    <Link href="/type/HKCategoryTypeIdentifierSleepAnalysis" className="card" style={{ padding: 20, display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--muted)" }}>Sleep</div>
          <div className="metric-num" style={{ fontSize: 34, fontWeight: 600, marginTop: 5 }}>
            {hoursAndMinutes(asleep)}
          </div>
        </div>
        <div style={{ color: "var(--faint)", fontSize: 12, textAlign: "right" }}>
          {sleep.date}
          <br />
          {hoursAndMinutes(sleep.inBedMinutes)} in bed
        </div>
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
        {rows.map((row) => (
          <div key={row.key}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: "var(--fg-soft)" }}>{row.label}</span>
              <span className="mono" style={{ color: "var(--muted)" }}>{hoursAndMinutes(row.minutes)}</span>
            </div>
            <div style={{ height: 7, marginTop: 5, borderRadius: 999, background: "var(--border)" }}>
              <div style={{ height: "100%", width: `${pct(row.minutes, asleep)}%`, borderRadius: 999, background: "var(--accent)", opacity: row.key === "deepMinutes" ? 0.95 : row.key === "remMinutes" ? 0.7 : 0.45 }} />
            </div>
          </div>
        ))}
        {sleep.awakeMinutes > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
            <span>Awake</span>
            <span className="mono">{hoursAndMinutes(sleep.awakeMinutes)}</span>
          </div>
        )}
      </div>

      {sleep.unspecifiedMinutes > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 12 }}>
          {hoursAndMinutes(sleep.unspecifiedMinutes)} unspecified asleep
        </div>
      )}
    </Link>
  );
}
