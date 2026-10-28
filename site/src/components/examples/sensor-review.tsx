"use client";
import { forwardRef, useRef, useState } from "react";
import recorded from "@/lib/sensor-recorded.json";
import {
  parseSensorReport,
  samplingStats,
  minuteCounts,
  type SensorReport,
} from "@/lib/sensor-report";
import { number } from "./report-visuals";
import { exportImage } from "./export-image";
import styles from "./examples.module.css";
const colors = ["#74c9ff", "#f5c985"];
const clock = (seconds: number) => {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};
const SensorPoster = forwardRef<SVGSVGElement, { report: SensorReport }>(
  function SensorPoster({ report }, ref) {
    const end = Math.max(...report.recordings.map((run) => run.seconds));
    const counts = report.recordings.map((run) => minuteCounts(run, end));
    const densityMax = Math.max(1, ...counts.flat());
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1080 1350"
        role="img"
        aria-label="Watch and Bluetooth heart-rate recording cadence"
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        <rect width="1080" height="1350" fill="#101d2e" />
        <text x="72" y="100" fill="#a9bdd2" fontSize="25">
          HEART RATE · RECORDING CADENCE
        </text>
        <text x="64" y="230" fill="#eef4fc" fontSize="86" fontWeight="600">
          Same metric.
        </text>
        <text x="64" y="330" fill="#74c9ff" fontSize="86" fontWeight="600">
          Different recordings.
        </text>
        {report.recordings.map((run, i) => {
          const stats = samplingStats(run);
          return (
            <g key={i}>
              <text x={72 + i * 490} y="475" fill={colors[i]} fontSize="32">
                {run.label}
              </text>
              <text x={72 + i * 490} y="595" fill={colors[i]} fontSize="86">
                {number(stats.median, 2)} s
              </text>
              <text x={72 + i * 490} y="650" fill="#a9bdd2" fontSize="24">
                median between readings
              </text>
              <text x={72 + i * 490} y="710" fill="#eef4fc" fontSize="30">
                {number(stats.count)} points
              </text>
              <text x={72 + i * 490} y="755" fill="#a9bdd2" fontSize="23">
                {number(run.km * 0.621371192, 2)} mi · {clock(run.seconds)}
              </text>
            </g>
          );
        })}
        {report.recordings.map((run, i) => (
          <g key={i}>
            {Array.from({ length: counts[i].length }, (_, minute) => {
              const count = counts[i][minute];
              return (
                <rect
                  key={minute}
                  x={72 + (minute / counts[i].length) * 936}
                  y={920 + i * 100 - (count / densityMax) * 60}
                  width={Math.max(0.4, 936 / counts[i].length - 3)}
                  height={(count / densityMax) * 60}
                  fill={colors[i]}
                />
              );
            })}
          </g>
        ))}
        <text x="72" y="1085" fill="#a9bdd2" fontSize="24">
          Each bar counts readings in one elapsed minute.
        </text>
        <text x="72" y="1150" fill="#eef4fc" fontSize="28">
          Separate runs. Accuracy cannot be inferred.
        </text>
        <text x="72" y="1205" fill="#a9bdd2" fontSize="23">
          Measured cadence of the synced workout streams.
        </text>
        <text x="72" y="1300" fill="#a9bdd2" fontSize="18">
          Made with PulsHealth
        </text>
      </svg>
    );
  },
);
export function SensorReview({ compact = false }: { compact?: boolean }) {
  const [report, setReport] = useState<SensorReport>(recorded),
    [mode, setMode] = useState<"readings" | "intervals">("readings"),
    [status, setStatus] = useState("");
  const poster = useRef<SVGSVGElement>(null),
    end = Math.max(...report.recordings.map((run) => run.seconds)),
    maxGap = Math.max(
      ...report.recordings.map((run) => samplingStats(run).longest),
    ),
    counts = report.recordings.map((run) => minuteCounts(run, end)),
    densityMax = Math.max(1, ...counts.flat()),
    ranges = report.recordings.flatMap((run) =>
      run.points.map((point) => point.value),
    ),
    low =
      Math.floor(ranges.reduce((min, v) => Math.min(min, v), Infinity) / 10) *
      10,
    high =
      Math.ceil(ranges.reduce((max, v) => Math.max(max, v), -Infinity) / 10) *
      10;
  if (compact) return <SensorPoster report={report} />;
  return (
    <div className={styles.demo}>
      <div className={styles.demoToolbar}>
        <span className={styles.dataBadge}>Inspiration</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                "https://pulshealth.com/inspiration/heart-rate-sensors/",
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
              Open comparison JSON
              <input
                type="file"
                accept=".json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 2000000)
                      throw new Error("Use a file smaller than 2 MB.");
                    setReport(parseSensorReport(await file.text()));
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
            <p>
              Your file stays in this browser. Recordings contain elapsed timing
              only.
            </p>
            <button onClick={() => setReport(recorded)}>Reset example</button>
          </div>
        </details>
      </div>
      <header className={styles.analysisHero}>
        <h2>
          Same metric.
          <br />
          <span>Different recordings.</span>
        </h2>
      </header>
      <div className={styles.sensorFinding}>
        <strong>
          {report.sharedRuns === 0
            ? "No simultaneous pair found"
            : `${report.sharedRuns} paired runs reported`}
        </strong>
        <p>
          {report.sharedRuns === 0
            ? "The Bluetooth-source run has no concurrent Watch-source heart-rate records in the synced data. The comparison below uses two separate runs of similar distance and duration."
            : "Pairing status comes from the source audit supplied with this file."}
        </p>
      </div>
      <div className={styles.headToHead}>
        {report.recordings.map((run, i) => {
          const stats = samplingStats(run);
          return (
            <article key={i} style={{ borderTopColor: colors[i] }}>
              <h3>{run.label}</h3>
              <strong className={styles.headPace} style={{ color: colors[i] }}>
                {number(stats.median, 2)}
                <small> sec</small>
              </strong>
              <p className={styles.shortNote}>
                Median recorded sampling interval
              </p>
              <dl>
                {[
                  [
                    "Workout",
                    `${number(run.km * 0.621371192, 2)} mi · ${clock(run.seconds)}`,
                  ],
                  ["HR points", number(stats.count)],
                  ["Points per minute", number(stats.perMinute, 1)],
                  ["95th percentile interval", `${number(stats.p95, 2)} s`],
                  ["Longest interval", `${number(stats.longest, 1)} s`],
                  ["Intervals over 10 sec", number(stats.over10)],
                  ["Intervals under 10 ms", number(stats.nearCoincident)],
                  ["Workout mean HR", `${number(run.meanHR, 1)} bpm`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        })}
      </div>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>How the recordings unfold</h2>
          <div className={styles.segment}>
            <button
              aria-pressed={mode === "readings"}
              onClick={() => setMode("readings")}
            >
              Heart rate
            </button>
            <button
              aria-pressed={mode === "intervals"}
              onClick={() => setMode("intervals")}
            >
              Sampling gaps
            </button>
          </div>
        </div>
        {report.recordings.map((run, i) => (
          <div key={i} className={styles.sensorTrace}>
            <h3 style={{ color: colors[i] }}>{run.label}</h3>
            <svg
              viewBox="0 0 960 230"
              role="img"
              aria-label={`${run.label} ${mode === "readings" ? "heart-rate readings" : "sampling intervals"} during a separate run`}
            >
              {[0, 0.5, 1].map((t) => (
                <g key={t}>
                  <line
                    x1="50"
                    x2="930"
                    y1={185 - t * 150}
                    y2={185 - t * 150}
                    stroke="#2b4056"
                  />
                  <text
                    x="40"
                    y={190 - t * 150}
                    textAnchor="end"
                    fill="#a9bdd2"
                    fontSize="12"
                  >
                    {number(
                      mode === "readings" ? low + t * (high - low) : t * maxGap,
                    )}
                  </text>
                  <text
                    x={50 + t * 880}
                    y="220"
                    textAnchor="middle"
                    fill="#a9bdd2"
                    fontSize="12"
                  >
                    {clock(t * end)}
                  </text>
                </g>
              ))}
              <text x="50" y="20" fill="#a9bdd2" fontSize="12">
                {mode === "readings" ? "bpm" : "seconds since previous reading"}
              </text>
              {mode === "readings" ? (
                <>
                  {run.points.map((point, j) => (
                    <circle
                      key={j}
                      cx={50 + (point.seconds / end) * 880}
                      cy={185 - ((point.value - low) / (high - low || 1)) * 150}
                      r="1.8"
                      fill={colors[i]}
                      opacity=".65"
                    />
                  ))}
                </>
              ) : (
                run.points
                  .slice(1)
                  .map((point, j) => (
                    <line
                      key={j}
                      x1={50 + (point.seconds / end) * 880}
                      x2={50 + (point.seconds / end) * 880}
                      y1="185"
                      y2={
                        185 -
                        ((point.seconds - run.points[j].seconds) / maxGap) * 150
                      }
                      stroke={colors[i]}
                      strokeWidth="1.5"
                    />
                  ))
              )}
            </svg>
          </div>
        ))}
        <p className={styles.micro}>
          Both charts use the same elapsed-time axis. These are separate
          workouts; heart-rate differences do not measure sensor agreement.
        </p>
      </section>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>Readings per minute</h2>
          <span>Recording density across each run</span>
        </div>
        {report.recordings.map((run, i) => (
          <div key={i} className={styles.sensorDensity}>
            <span style={{ color: colors[i] }}>{run.label}</span>
            <svg
              viewBox="0 0 880 65"
              role="img"
              aria-label={`${run.label} readings per minute`}
            >
              {Array.from({ length: Math.ceil(end / 60) }, (_, minute) => {
                const count = counts[i][minute];
                return (
                  <rect
                    key={minute}
                    x={(minute / (end / 60)) * 880}
                    y={60 - (count / densityMax) * 60}
                    width={Math.max(0.4, 880 / Math.ceil(end / 60) - 3)}
                    height={(count / densityMax) * 60}
                    fill={colors[i]}
                  >
                    <title>
                      Minute {minute + 1}: {count} readings
                    </title>
                  </rect>
                );
              })}
            </svg>
          </div>
        ))}
      </section>
      <section className={styles.reportSection}>
        <h2>How often is the next reading?</h2>
        <div className={styles.intervalTable}>
          <table>
            <thead>
              <tr>
                <th>Interval</th>
                {report.recordings.map((run) => (
                  <th key={run.label}>{run.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                "Under 1 s",
                "1–2 s",
                "2–5 s",
                "5–10 s",
                "10–30 s",
                "30 s or more",
              ].map((label, i) => (
                <tr key={label}>
                  <td>{label}</td>
                  {report.recordings.map((run) => (
                    <td key={run.label}>
                      {number(samplingStats(run).buckets[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className={styles.micro}>
        Intervals use expanded workout heart-rate points. HealthKit can group
        many readings into one raw quantity sample; raw object counts do not
        establish sampling cadence. Near-coincident timestamps remain distinct
        recorded observations and do not establish hardware polling rates.
        Source names identify the writer, and the external sensor model was not
        retained. No same-effort accuracy conclusion is drawn.
      </p>
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
                      "heart-rate-recordings",
                      share,
                    ),
                  );
              } catch {
                setStatus("Could not export comparison.");
              }
            }}
          >
            {share ? "Share image" : "Save image"}
          </button>
        ))}
        <p role="status">{status}</p>
      </div>
      <div className={styles.exportOnly} aria-hidden="true">
        <SensorPoster ref={poster} report={report} />
      </div>
    </div>
  );
}
