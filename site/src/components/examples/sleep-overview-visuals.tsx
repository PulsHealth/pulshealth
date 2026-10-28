import { SLEEP_COLORS, sleepTime, type SleepStage } from "@/lib/sleep-report";
import { sleepOverview } from "@/lib/sleep-overview";
import { number } from "./report-visuals";
import styles from "./examples.module.css";
export type Overview = ReturnType<typeof sleepOverview>;
export const PHASE_COLORS = ["#74c9ff", "#f5c985"];
export const minuteLabel = (minutes: number | null) =>
  minutes === null
    ? "—"
    : minutes >= 60
      ? sleepTime(minutes)
      : `${number(minutes, 1)} min`;
export function SleepLengthPlot({ overview }: { overview: Overview }) {
  const max = Math.max(
      0.001,
      ...overview.series.flatMap((series) =>
        series.density.map((point) => point.value),
      ),
    ),
    x = (minutes: number) => 35 + (minutes / overview.domain) * 650;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="720"
      height="290"
      viewBox="0 0 720 290"
      role="img"
      aria-label="Distribution of recorded sleep duration before and after"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line
            x1={35 + t * 650}
            x2={35 + t * 650}
            y1="18"
            y2="220"
            stroke="#2c4158"
          />
          <text
            x={35 + t * 650}
            y="252"
            textAnchor="middle"
            fill="#a9bdd2"
            fontSize="22"
          >
            {number((t * overview.domain) / 60)}h
          </text>
        </g>
      ))}
      {overview.series.map((series, i) => {
        const line = series.density
          .map(
            (point, j) =>
              `${j ? "L" : "M"}${x(point.minutes)},${218 - (point.value / max) * 185}`,
          )
          .join(" ");
        return (
          <g key={series.label}>
            <path
              d={`${line} L685,218 L35,218 Z`}
              fill={PHASE_COLORS[i]}
              fillOpacity=".16"
            />
            <path
              d={line}
              fill="none"
              stroke={PHASE_COLORS[i]}
              strokeWidth="3"
            />
            {series.summary.median !== null && (
              <line
                x1={x(series.summary.median)}
                x2={x(series.summary.median)}
                y1={i ? 70 : 20}
                y2="220"
                stroke={PHASE_COLORS[i]}
                strokeDasharray="5 5"
                strokeWidth="2"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
export function PhaseLegend() {
  return (
    <div className={styles.overviewLegend}>
      {["Before", "After"].map((label, i) => (
        <span key={label}>
          <i style={{ background: PHASE_COLORS[i] }} />
          {label}
        </span>
      ))}
    </div>
  );
}
export function PairedBuckets({
  overview,
  mode,
}: {
  overview: Overview;
  mode: "awake" | "episodes";
}) {
  const labels =
    mode === "awake"
      ? ["<10 min", "10–30 min", "30–60 min", "1–2 hr", "2+ hr"]
      : ["0–2", "3–5", "6–8", "9+"];
  const max = Math.max(
    1,
    ...overview.series.flatMap((series) =>
      series[mode].flatMap((value) => (value === null ? [] : [value])),
    ),
  );
  return (
    <div
      className={styles.overviewBuckets}
      style={{ gridTemplateColumns: `repeat(${labels.length},minmax(0,1fr))` }}
    >
      {labels.map((label, index) => (
        <div key={label}>
          <div className={styles.overviewBucketPair}>
            {overview.series.map((series, i) => (
              <div key={series.label}>
                <span style={{ color: PHASE_COLORS[i] }}>
                  {series[mode][index] === null
                    ? "—"
                    : `${number(series[mode][index])}%`}
                </span>
                <i
                  style={{
                    height: `${((series[mode][index] ?? 0) / max) * 145}px`,
                    background: PHASE_COLORS[i],
                  }}
                  aria-label={`${series.label}: ${number(series[mode][index])}% of recorded nights, ${label}`}
                />
              </div>
            ))}
          </div>
          <strong>{label}</strong>
        </div>
      ))}
    </div>
  );
}
export function StageMix({ overview }: { overview: Overview }) {
  const stageKeys: Exclude<SleepStage, "unknown">[] = [
    "deep",
    "core",
    "rem",
    "awake",
    "unspecified",
  ];
  const labels = {
    deep: "Deep",
    core: "Core",
    rem: "REM",
    awake: "Awake",
    unspecified: "Unstaged",
  };
  return (
    <>
      <div className={styles.overviewStageBars}>
        {overview.series.map((series, i) => (
          <div key={series.label}>
            <strong style={{ color: PHASE_COLORS[i] }}>{series.label}</strong>
            <div>
              {stageKeys.map((stage) => {
                const value = series.stages[stage];
                return value !== null && value > 0 ? (
                  <span
                    key={stage}
                    style={{
                      width: `${value}%`,
                      background: SLEEP_COLORS[stage],
                      color: "#101d2e",
                    }}
                    title={`${labels[stage]}: ${number(value, 1)}%`}
                  >
                    {value >= 12 ? `${number(value)}%` : ""}
                  </span>
                ) : null;
              })}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.overviewStageLegend}>
        {(["deep", "core", "rem", "awake"] as const).map((stage) => (
          <div key={stage}>
            <span>
              <i style={{ background: SLEEP_COLORS[stage] }} />
              {labels[stage]}
            </span>
            <strong>
              {minuteLabel(
                stage === "awake"
                  ? overview.series[0].summary.awakeDuringSleep
                  : overview.series[0].summary[stage],
              )}{" "}
              <small>→</small>{" "}
              {minuteLabel(
                stage === "awake"
                  ? overview.series[1].summary.awakeDuringSleep
                  : overview.series[1].summary[stage],
              )}
            </strong>
            <small>median per night</small>
          </div>
        ))}
      </div>
    </>
  );
}
export function SleepProgression({
  overview,
  mode,
}: {
  overview: Overview;
  mode: "median" | "awakeDuringSleep" | "episodes";
}) {
  const values = overview.progression.map((point) => point.summary[mode]),
    known = values.filter((v): v is number => v !== null),
    max = Math.max(1, ...known),
    min = Math.min(...known, max),
    padding = Math.max(1, (max - min) * 0.25),
    low = Math.max(0, min - padding),
    high = max + padding;
  const x = (i: number) => ((i + 0.5) / values.length) * 720,
    y = (value: number) => 185 - ((value - low) / (high - low || 1)) * 145;
  return (
    <>
      <div
        className={styles.overviewProgressValues}
        style={{ gridTemplateColumns: `repeat(${values.length},1fr)` }}
      >
        {values.map((value, i) => (
          <strong
            key={i}
            style={{ color: i ? PHASE_COLORS[1] : PHASE_COLORS[0] }}
          >
            {mode === "episodes" ? number(value, 1) : minuteLabel(value)}
          </strong>
        ))}
      </div>
      <svg
        viewBox="0 0 720 210"
        role="img"
        aria-label="Broad sleep pattern across periods after the arrival"
      >
        {values[0] !== null && (
          <line
            x1="20"
            x2="700"
            y1={y(values[0])}
            y2={y(values[0])}
            stroke="#5b7187"
            strokeDasharray="5 5"
          />
        )}
        {values.map((value, i) =>
          value === null ? null : (
            <g key={i}>
              {i > 0 && values[i - 1] !== null && (
                <line
                  x1={x(i - 1)}
                  x2={x(i)}
                  y1={y(values[i - 1]!)}
                  y2={y(value)}
                  stroke={PHASE_COLORS[1]}
                  strokeWidth="3"
                />
              )}
              <circle
                cx={x(i)}
                cy={y(value)}
                r="7"
                fill={PHASE_COLORS[i ? 1 : 0]}
              />
            </g>
          ),
        )}
      </svg>
      <div
        className={styles.overviewProgressLabels}
        style={{ gridTemplateColumns: `repeat(${values.length},1fr)` }}
      >
        {overview.progression.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </>
  );
}
