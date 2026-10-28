"use client";
import { forwardRef, useRef, useState } from "react";
import type { Report } from "@/lib/example-report";
import { MONTH_NAMES } from "@/lib/example-report";
import type { RouteComparison } from "@/lib/route-comparisons";
import { number } from "./report-visuals";
import { RunReplay } from "./run-replay";
import { exportImage } from "./export-image";
import styles from "./examples.module.css";
const miles = 0.621371192;
const paceValue = (run: RouteComparison["attempts"][number]) =>
  run.minutes / (run.km * miles);
const pace = (minutes: number) => {
  const seconds = Math.round(minutes * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const runTime = (minutes: number) => {
  const seconds = Math.round(minutes * 60);
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const colors = ["#74c9ff", "#f5c985", "#d7b8ff", "#8ce5ca"];

const ComparisonPoster = forwardRef<SVGSVGElement, { group: RouteComparison }>(
  function ComparisonPoster({ group }, ref) {
    const values = group.attempts.map(paceValue),
      fastest = Math.min(...values),
      slowest = Math.max(...values);
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1080 1350"
        role="img"
        aria-label={`${group.name}, ${group.attempts.length} repeated runs`}
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        <rect width="1080" height="1350" fill="#101d2e" />
        <text x="70" y="100" fill="#a9bdd2" fontSize="25">
          DEEP WORKOUT ANALYSIS
        </text>
        <text x="64" y="215" fill="#eef4fc" fontSize="83" fontWeight="600">
          Same route.
        </text>
        <text x="64" y="310" fill="#74c9ff" fontSize="83" fontWeight="600">
          {group.attempts.length} different runs.
        </text>
        <g transform="translate(75 370) scale(1.28)">
          {group.attempts.map((run, i) => (
            <path
              key={i}
              d={run.path}
              fill="none"
              stroke={colors[i % colors.length]}
              opacity=".65"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </g>
        <text x="70" y="990" fill="#f5c985" fontSize="70">
          {pace(fastest)}
        </text>
        <text x="70" y="1035" fill="#a9bdd2" fontSize="23">
          fastest recorded min/mi
        </text>
        <text x="590" y="990" fill="#eef4fc" fontSize="70">
          {pace(slowest)}
        </text>
        <text x="590" y="1035" fill="#a9bdd2" fontSize="23">
          slowest recorded min/mi
        </text>
        <text x="70" y="1150" fill="#a9bdd2" fontSize="24">
          Geographically matched routes · {group.name}
        </text>
        <text x="70" y="1200" fill="#a9bdd2" fontSize="21">
          Recorded workout pace; conditions and stops may differ.
        </text>
        <text x="70" y="1300" fill="#a9bdd2" fontSize="18">
          Made with PulsHealth
        </text>
      </svg>
    );
  },
);

export function WorkoutAnalysis({
  report,
  compact = false,
}: {
  report: Report;
  compact?: boolean;
}) {
  const groups = report.routeComparisons ?? [];
  const [groupIndex, setGroupIndex] = useState(0),
    [attempt, setAttempt] = useState((groups[0]?.attempts.length ?? 1) - 1),
    [baseline, setBaseline] = useState(0),
    [status, setStatus] = useState("");
  const poster = useRef<SVGSVGElement>(null);
  const group = groups[Math.min(groupIndex, groups.length - 1)];
  if (!group)
    return (
      <section className={styles.reportSection}>
        <h2>No repeated running routes found</h2>
        <p className={styles.shortNote}>
          Add runs with GPS routes to compare repeated efforts.
        </p>
      </section>
    );
  if (compact) return <ComparisonPoster group={group} />;
  const selected = group.attempts[Math.min(attempt, group.attempts.length - 1)],
    reference = group.attempts[Math.min(baseline, group.attempts.length - 1)];
  const values = group.attempts.map(paceValue),
    best = Math.min(...values),
    worst = Math.max(...values);
  const delta = (paceValue(selected) - paceValue(reference)) * 60;
  const sorted = [...values].sort((a, b) => a - b),
    median =
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.ceil((sorted.length - 1) / 2)]) /
      2;
  return (
    <div>
      <header className={styles.analysisHero}>
        <h2>
          Same route.
          <br />
          <span>A different run.</span>
        </h2>
        <div className={styles.sectionStats}>
          <div>
            <strong>{groups.length}</strong>
            <span>matched routes</span>
          </div>
          <div>
            <strong>{groups.reduce((n, g) => n + g.attempts.length, 0)}</strong>
            <span>repeated runs</span>
          </div>
        </div>
      </header>
      <div className={styles.groupChoices} aria-label="Choose a repeated route">
        {groups.map((g, i) => (
          <button
            key={g.name}
            aria-pressed={groupIndex === i}
            onClick={() => {
              setGroupIndex(i);
              setAttempt(g.attempts.length - 1);
              setBaseline(0);
            }}
          >
            {g.name}
            <small>{g.attempts.length} runs</small>
          </button>
        ))}
      </div>
      <div className={styles.analysisGrid}>
        <section className={styles.reportSection}>
          <div className={styles.sectionTitle}>
            <h2>{group.name}</h2>
            <span>{group.attempts.length} recorded efforts</span>
          </div>
          <svg
            viewBox="0 0 720 420"
            role="img"
            aria-label="Overlay of geographically matched running routes"
          >
            {group.attempts.map((run, i) => (
              <path
                key={i}
                d={run.path}
                fill="none"
                stroke={i === attempt ? "#f5c985" : "#74c9ff"}
                opacity={i === attempt ? 1 : 0.18}
                strokeWidth={i === attempt ? 3 : 1.5}
              />
            ))}
            <path
              d={selected.path}
              fill="none"
              stroke="#f5c985"
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
          <div className={styles.sectionStats}>
            <div>
              <strong>{pace(best)}</strong>
              <span>fastest min/mi</span>
            </div>
            <div>
              <strong>{pace(median)}</strong>
              <span>median min/mi</span>
            </div>
            <div>
              <strong>{number(selected.km * miles, 2)}</strong>
              <span>selected run miles</span>
            </div>
          </div>
        </section>
        <aside className={styles.weekDetail}>
          <h2>
            Run {attempt + 1} <small>· {MONTH_NAMES[selected.month - 1]}</small>
          </h2>
          <div className={styles.selectedPace}>
            <strong>{pace(paceValue(selected))}</strong>
            <span>min/mi</span>
          </div>
          <label className={styles.baseline}>
            Compare with
            <select
              value={baseline}
              onChange={(e) => setBaseline(Number(e.target.value))}
            >
              {group.attempts.map((run, i) => (
                <option key={i} value={i}>
                  Run {i + 1} · {MONTH_NAMES[run.month - 1]}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.paceDelta}>
            {attempt === baseline
              ? "Baseline run"
              : Math.abs(delta) < 0.5
                ? "Same recorded pace"
                : `${number(Math.abs(delta))} sec/mi ${delta < 0 ? "faster" : "slower"}`}
          </p>
          <div className={styles.raceMetrics}>
            {[
              { v: runTime(selected.minutes), label: "recorded duration" },
              {
                v: `${number(((selected.km * miles) / selected.minutes) * 60, 1)} mph`,
                label: "average speed",
              },
              ...(selected.metrics?.heartRate === undefined
                ? []
                : [
                    {
                      v: `${number(selected.metrics.heartRate)} bpm`,
                      label: "average heart rate",
                    },
                  ]),
              ...(selected.metrics?.powerW === undefined
                ? []
                : [
                    {
                      v: `${number(selected.metrics.powerW)} W`,
                      label: "average running power",
                    },
                  ]),
            ].map((x) => (
              <div key={x.label}>
                <strong>{x.v}</strong>
                <span>{x.label}</span>
              </div>
            ))}
          </div>
          {selected.metrics?.heartRate !== undefined &&
            reference.metrics?.heartRate !== undefined &&
            attempt !== baseline && (
              <p className={styles.shortNote}>
                Average heart rate{" "}
                {number(
                  Math.abs(
                    selected.metrics.heartRate - reference.metrics.heartRate,
                  ),
                )}{" "}
                bpm{" "}
                {selected.metrics.heartRate >= reference.metrics.heartRate
                  ? "higher"
                  : "lower"}{" "}
                than Run {baseline + 1}.
              </p>
            )}
        </aside>
      </div>
      <RunReplay key={group.name} group={group} selected={attempt} baseline={baseline} />
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>Every effort, side by side</h2>
          <span>Recorded pace · min/mi</span>
        </div>
        <div className={styles.effortChart}>
          {group.attempts.map((run, i) => (
            <button
              key={i}
              aria-pressed={attempt === i}
              aria-label={`Run ${i + 1}, ${pace(paceValue(run))} per mile`}
              onClick={() => setAttempt(i)}
            >
              <span>{i + 1}</span>
              <i
                style={{
                  height: `${35 + ((worst - paceValue(run)) / (worst - best || 1)) * 80}px`,
                  background: attempt === i ? "#f5c985" : "#74c9ff",
                }}
              />
              <strong>{pace(paceValue(run))}</strong>
              <small>{MONTH_NAMES[run.month - 1]}</small>
            </button>
          ))}
        </div>
        <p className={styles.micro}>
          Taller bars show faster recorded pace. Runs appear in chronological
          order.
        </p>
        <div className={styles.attemptTable}>
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Month</th>
                <th>Miles</th>
                <th>Time</th>
                <th>Pace /mi</th>
                <th>Avg HR</th>
                <th>Avg power</th>
              </tr>
            </thead>
            <tbody>
              {group.attempts.map((run, i) => (
                <tr key={i} data-selected={attempt === i}>
                  <td>
                    <button
                      onClick={() => setAttempt(i)}
                      aria-pressed={attempt === i}
                    >
                      {i + 1}
                      {paceValue(run) === best ? " ★" : ""}
                    </button>
                  </td>
                  <td>{MONTH_NAMES[run.month - 1]}</td>
                  <td>{number(run.km * miles, 2)}</td>
                  <td>{runTime(run.minutes)}</td>
                  <td>{pace(paceValue(run))}</td>
                  <td>
                    {number(run.metrics?.heartRate ?? null)}
                    {run.metrics?.heartRate === undefined ? "" : " bpm"}
                  </td>
                  <td>
                    {number(run.metrics?.powerW ?? null)}
                    {run.metrics?.powerW === undefined ? "" : " W"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className={styles.raceFooter}>
        <button
          className={styles.primaryButton}
          onClick={async () => {
            try {
              if (poster.current)
                setStatus(
                  await exportImage(poster.current, "same-route-analysis"),
                );
            } catch {
              setStatus("Could not export comparison.");
            }
          }}
        >
          Save comparison image
        </button>
        <button onClick={async () => { try { if (poster.current) setStatus(await exportImage(poster.current, "same-route-analysis", true)); } catch { setStatus("Could not share comparison."); } }}>Share comparison</button>
        <p role="status">{status}</p>
      </div>
      <p className={styles.micro}>
        Similar routes, same direction, within 8% recorded distance. At least
        95% of sampled points must lie within 75 m of the other track in both
        directions. Conditions, stops and effort can differ.
      </p>
      <div className={styles.exportOnly} aria-hidden="true">
        <ComparisonPoster ref={poster} group={group} />
      </div>
    </div>
  );
}
