"use client";
import { forwardRef, useMemo, useRef, useState } from "react";
import recorded from "@/lib/sleep-recorded.json";
import {
  parseSleepReport,
  sleepTime,
  SLEEP_COLORS,
  type SleepReport,
} from "@/lib/sleep-report";
import { sleepOverview } from "@/lib/sleep-overview";
import { number } from "./report-visuals";
import { exportImage } from "./export-image";
import {
  SleepLengthPlot,
  PhaseLegend,
  PairedBuckets,
  StageMix,
  SleepProgression,
  PHASE_COLORS,
  minuteLabel,
  type Overview,
} from "./sleep-overview-visuals";
import styles from "./examples.module.css";
const initialReport = parseSleepReport(JSON.stringify(recorded));
const SleepPoster = forwardRef<
  SVGSVGElement,
  { overview: Overview; window: number }
>(function SleepPoster({ overview, window }, ref) {
  const [before, after] = overview.series;
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1080 1350"
      role="img"
      aria-label="Sleep duration, stages and recorded interruptions before and after"
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      <rect width="1080" height="1350" fill="#101d2e" />
      <text x="72" y="95" fill="#a9bdd2" fontSize="25">
        SLEEP · BEFORE &amp; AFTER
      </text>
      <text x="64" y="225" fill="#eef4fc" fontSize="86" fontWeight="600">
        Sleep changes
      </text>
      <text x="72" y="278" fill="#eef4fc" fontSize="48">
        with a newborn.
      </text>
      <text x="72" y="315" fill="#a9bdd2" fontSize="24">
        Median sleep per night
      </text>
      {overview.series.map((series, i) => (
        <g key={i}>
          <text x={72 + i * 498} y="375" fill={PHASE_COLORS[i]} fontSize="76">
            {sleepTime(series.summary.median)}
          </text>
          <text x={72 + i * 498} y="425" fill="#a9bdd2" fontSize="26">
            {series.label} · {window} nights
          </text>
        </g>
      ))}
      <g transform="translate(72 465) scale(1.3)">
        <SleepLengthPlot overview={overview} />
      </g>
      {overview.series.map((series, i) => {
        let x = 72;
        return (
          <g key={i}>
            <text x="72" y={875 + i * 80} fill={PHASE_COLORS[i]} fontSize="22">
              {series.label} · stage mix
            </text>
            {(["deep", "core", "rem", "awake", "unspecified"] as const).map(
              (stage) => {
                const width = ((series.stages[stage] ?? 0) / 100) * 936,
                  position = x;
                x += width;
                return (
                  <rect
                    key={stage}
                    x={position}
                    y={890 + i * 80}
                    width={width}
                    height="26"
                    fill={SLEEP_COLORS[stage]}
                  />
                );
              },
            )}
          </g>
        );
      })}
      <text x="72" y="1090" fill="#eef4fc" fontSize="44">
        {minuteLabel(before.summary.awakeDuringSleep)} →{" "}
        {minuteLabel(after.summary.awakeDuringSleep)}
      </text>
      <text x="72" y="1135" fill="#a9bdd2" fontSize="24">
        median recorded awake time per night
      </text>
      {(["deep", "core", "rem", "awake"] as const).map((stage, i) => (
        <g key={stage} transform={`translate(${72 + i * 235} 1190)`}>
          <rect width="15" height="15" fill={SLEEP_COLORS[stage]} />
          <text x="25" y="15" fill="#a9bdd2" fontSize="22">
            {stage.toUpperCase()}
          </text>
        </g>
      ))}
      <text x="72" y="1250" fill="#a9bdd2" fontSize="21">
        {before.summary.count}/{before.summary.available} before ·{" "}
        {after.summary.count}/{after.summary.available} after nights recorded
      </text>
      <text x="72" y="1300" fill="#a9bdd2" fontSize="18">
        Made with PulsHealth
      </text>
    </svg>
  );
});
export function SleepReview({ compact = false }: { compact?: boolean }) {
  const [report, setReport] = useState<SleepReport>(initialReport),
    [window, setWindow] = useState(90),
    [interruptionMode, setInterruptionMode] = useState<"awake" | "episodes">(
      "awake",
    ),
    [trendMode, setTrendMode] = useState<
      "median" | "awakeDuringSleep" | "episodes"
    >("awakeDuringSleep"),
    [status, setStatus] = useState("");
  const poster = useRef<SVGSVGElement>(null),
    overview = useMemo(
      () => sleepOverview(report.milestones[0], window),
      [report, window],
    ),
    [before, after] = overview.series;
  const change =
    before.summary.median === null || after.summary.median === null
      ? null
      : Math.round(after.summary.median - before.summary.median);
  if (compact) return <SleepPoster overview={overview} window={window} />;
  return (
    <div className={styles.demo}>
      <div className={styles.demoToolbar}>
        <span className={styles.dataBadge}>Inspiration</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                "https://pulshealth.com/inspiration/sleep-and-parenthood/",
              );
              setStatus("Link copied");
            } catch {
              setStatus("Could not copy link.");
            }
          }}
        >
          Copy link
        </button>
        <details className={styles.importDetails}>
          <summary>Use your data</summary>
          <div>
            <label>
              Open relative sleep JSON
              <input
                type="file"
                accept=".json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 5000000)
                      throw new Error("Use a file smaller than 5 MB.");
                    setReport(parseSleepReport(await file.text()));
                    setStatus("");
                  } catch (error) {
                    setStatus(
                      error instanceof Error
                        ? error.message
                        : "Could not read file.",
                    );
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <p>Your file stays in this browser.</p>
            <button onClick={() => setReport(initialReport)}>
              Reset example
            </button>
          </div>
        </details>
      </div>
      <header className={styles.sleepOverviewHero}>
        <div>
          <h2>Sleep changes with a newborn</h2>
          <p>The overall pattern around a new arrival.</p>
        </div>
        <div className={styles.segment} aria-label="Comparison period">
          {[
            { days: 7, label: "1 week" },
            { days: 14, label: "2 weeks" },
            { days: 30, label: "1 month" },
            { days: 90, label: "3 months" },
          ].map((period) => (
            <button
              key={period.days}
              aria-pressed={window === period.days}
              onClick={() => setWindow(period.days)}
            >
              {period.label}
            </button>
          ))}
        </div>
      </header>
      <div className={styles.sleepMedianComparison}>
        {overview.series.map((series, i) => (
          <div key={series.label}>
            <span style={{ color: PHASE_COLORS[i] }}>{series.label}</span>
            <strong>{sleepTime(series.summary.median)}</strong>
            <small>median sleep per night</small>
          </div>
        ))}
        <div className={styles.sleepChange}>
          <strong>{change === null ? "—" : `${Math.abs(change)} min`}</strong>
          <span>
            {change === null
              ? "No comparison"
              : change < 0
                ? "shorter at the median"
                : change > 0
                  ? "longer at the median"
                  : "no change at the median"}
          </span>
        </div>
      </div>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>The length of a night</h2>
          <PhaseLegend />
        </div>
        <SleepLengthPlot overview={overview} />
        <div className={styles.overviewSmallStats}>
          <div>
            <span>Nights under 6 hours</span>
            <strong>
              {number(before.summary.short)}% <small>→</small>{" "}
              {number(after.summary.short)}%
            </strong>
          </div>
          <div>
            <span>Middle half of nights · before</span>
            <strong>
              {sleepTime(before.summary.lower)}–
              {sleepTime(before.summary.upper)}
            </strong>
          </div>
          <div>
            <span>Middle half of nights · after</span>
            <strong>
              {sleepTime(after.summary.lower)}–{sleepTime(after.summary.upper)}
            </strong>
          </div>
        </div>
        <p className={styles.micro}>
          Each curve shows the spread of recorded sleep durations; dashed lines
          mark the medians.
        </p>
      </section>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>The interruption pattern</h2>
          <div className={styles.segment}>
            <button
              aria-pressed={interruptionMode === "awake"}
              onClick={() => setInterruptionMode("awake")}
            >
              Time awake
            </button>
            <button
              aria-pressed={interruptionMode === "episodes"}
              onClick={() => setInterruptionMode("episodes")}
            >
              Awakenings
            </button>
          </div>
        </div>
        <PhaseLegend />
        <PairedBuckets overview={overview} mode={interruptionMode} />
        <p className={styles.micro}>
          Share of recorded nights ·{" "}
          {interruptionMode === "awake"
            ? "total recorded awake time within sleep sessions"
            : "recorded awake periods lasting at least one minute"}
        </p>
        <div className={styles.overviewSmallStats}>
          <div>
            <span>Typical recorded awake time / night</span>
            <strong>
              {minuteLabel(before.summary.awakeDuringSleep)} <small>→</small>{" "}
              {minuteLabel(after.summary.awakeDuringSleep)}
            </strong>
          </div>
          <div>
            <span>Typical awakenings / night · 1+ min</span>
            <strong>
              {number(before.summary.episodes, 1)} <small>→</small>{" "}
              {number(after.summary.episodes, 1)}
            </strong>
          </div>
          <div>
            <span>Longest recorded sleep stretch / night</span>
            <strong>
              {sleepTime(before.summary.longestSleep)} <small>→</small>{" "}
              {sleepTime(after.summary.longestSleep)}
            </strong>
          </div>
        </div>
      </section>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>How the stages shifted</h2>
          <span>Share of recorded stage time</span>
        </div>
        <StageMix overview={overview} />
        <p className={styles.micro}>
          Stage proportions include recorded awake periods; gaps are excluded.
        </p>
      </section>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>Finding a new rhythm</h2>
          <div className={styles.segment}>
            <button
              aria-pressed={trendMode === "median"}
              onClick={() => setTrendMode("median")}
            >
              Sleep
            </button>
            <button
              aria-pressed={trendMode === "awakeDuringSleep"}
              onClick={() => setTrendMode("awakeDuringSleep")}
            >
              Awake time
            </button>
            <button
              aria-pressed={trendMode === "episodes"}
              onClick={() => setTrendMode("episodes")}
            >
              Awakenings
            </button>
          </div>
        </div>
        <SleepProgression overview={overview} mode={trendMode} />
        <p className={styles.micro}>
          Medians for broad periods; the dashed line is the before baseline.
        </p>
      </section>
      <div className={styles.raceFooter}>
        {[false, true].map((share) => (
          <button
            key={String(share)}
            className={share ? undefined : styles.primaryButton}
            onClick={async () => {
              try {
                if (poster.current)
                  setStatus(
                    await exportImage(
                      poster.current,
                      "sleep-before-after",
                      share,
                    ),
                  );
              } catch {
                setStatus("Could not export sleep image.");
              }
            }}
          >
            {share ? "Share image" : "Save image"}
          </button>
        ))}
        <p role="status">{status}</p>
      </div>
      <p className={styles.micro}>
        {before.summary.count}/{before.summary.available} before nights and{" "}
        {after.summary.count}/{after.summary.available} after nights recorded.
        Awake periods reflect recorded stages, not every possible interruption.
      </p>
      <div className={styles.exportOnly} aria-hidden="true">
        <SleepPoster ref={poster} overview={overview} window={window} />
      </div>
    </div>
  );
}
