import Link from "next/link";
import { sleepScoreClassification, type SleepScore } from "@/lib/sleep";
import { GROUP_COLOR } from "@/lib/colors";
import { Sparkline } from "./Sparkline";
import { ArrowDown, ArrowUp } from "./Icons";

type ScoredNight = { night: { date: string }; score: SleepScore };

function trendDelta(values: number[]): number | null {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 4) return null;
  const half = Math.floor(clean.length / 2);
  const a = clean.slice(0, half).reduce((x, y) => x + y, 0) / half;
  const b = clean.slice(half).reduce((x, y) => x + y, 0) / (clean.length - half);
  return a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null;
}

export function SleepScoreCard({
  score,
  history,
  compact,
}: {
  score: ScoredNight["score"] | null;
  history: ScoredNight[];
  compact?: boolean;
}) {
  const color = GROUP_COLOR.sleep;
  // calculateSleepScores returns chronological history, matching MetricCard trend semantics.
  const spark = history.map((entry) => entry.score.score);
  const delta = trendDelta(spark);

  return (
    <Link href="/sleep/score" className="card" style={{ padding: compact ? 14 : 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="dot" style={{ background: color }} />
          <span style={{ color: "var(--fg-soft)", fontSize: 13.5 }}>Sleep Score</span>
        </div>
        {delta != null && (
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
        <div>
          <div className="metric-num" style={{ fontSize: 30, fontWeight: 600 }}>
            {score?.score ?? "—"}
            {score && <span style={{ fontSize: 13, fontWeight: 400, color: "var(--muted)", marginLeft: 4 }}>/ 100</span>}
          </div>
          {score && (
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>
              {sleepScoreClassification(score.score)}
            </div>
          )}
        </div>
        <Sparkline values={spark} color={color} />
      </div>
    </Link>
  );
}
