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
const matchedRoute = (report: SensorReport) =>
  report.recordings.every((run) => run.path) &&
  !!report.recordings[0].routeMatch &&
  report.recordings[0].routeMatch.coveragePercent >= 95 &&
  report.recordings[0].routeMatch.p95Feet <=
    report.recordings[0].routeMatch.thresholdFeet;
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
          {matchedRoute(report) ? "One route." : "Heart rate."}
        </text>
        <text x="64" y="330" fill="#74c9ff" fontSize="86" fontWeight="600">
          Two recordings.
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
          Separate runs · recorded heart-rate streams
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
  const [data, setReport] = useState<SensorReport>(recorded),
    [watchIndex, setWatchIndex] = useState(0),
    [mode, setMode] = useState<"readings" | "intervals">("readings"),
    [status, setStatus] = useState("");
  const watchRuns = data.watchRuns ?? [data.recordings[0]];
  const activeWatch = Math.min(watchIndex, watchRuns.length - 1);
  const report: SensorReport = {
    ...data,
    recordings: [watchRuns[activeWatch], data.recordings[1]],
  };
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
                    setWatchIndex(0);
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
            <button
              onClick={() => {
                setReport(recorded);
                setWatchIndex(0);
              }}
            >
              Reset example
            </button>
          </div>
        </details>
      </div>
      <header className={styles.analysisHero}>
        <h2>
          {matchedRoute(report) ? "One route." : "Heart rate."}
          <br />
          <span>Two recordings.</span>
        </h2>
      </header>
      {report.recordings[0].path && report.recordings[1].path && (
        <section className={styles.sensorRouteCard}>
          <div className={styles.sectionTitle}>
            <div>
              <h2>
                {matchedRoute(report) ? "A familiar route" : "Recorded routes"}
              </h2>
              <p>
                {watchRuns.length} Watch{" "}
                {watchRuns.length === 1 ? "run" : "runs"}. One external-sensor
                recording.
              </p>
            </div>
            <label className={styles.baseline}>
              Compare
              <select
                aria-label="Watch comparison run"
                value={activeWatch}
                onChange={(event) => setWatchIndex(Number(event.target.value))}
              >
                {watchRuns.map((run, i) => (
                  <option key={i} value={i}>
                    Watch run {i + 1} · {number(run.km * 0.621371192, 2)} mi ·{" "}
                    {clock(run.seconds)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.sensorRouteGrid}>
            <svg
              viewBox="0 0 720 420"
              role="img"
              aria-label="Overlaid GPS tracks of the matched Watch and Bluetooth runs"
            >
              {report.recordings.map((run, i) => (
                <path
                  key={i}
                  d={run.path}
                  fill="none"
                  stroke={colors[i]}
                  strokeWidth={i ? 2 : 4}
                  strokeOpacity={i ? 0.9 : 0.55}
                  strokeLinecap="round"
                />
              ))}
            </svg>
            <div className={styles.sensorRouteFacts}>
              {report.recordings[0].routeMatch && (
                <>
                  <div>
                    <strong>
                      {number(
                        report.recordings[0].routeMatch?.coveragePercent ??
                          null,
                      )}
                      %
                    </strong>
                    <span>
                      sampled route points within{" "}
                      {number(
                        report.recordings[0].routeMatch?.thresholdFeet ?? null,
                      )}{" "}
                      ft
                    </span>
                  </div>
                  <div>
                    <strong>
                      {number(report.recordings[0].routeMatch?.p95Feet ?? null)}{" "}
                      ft
                    </strong>
                    <span>95th-percentile track separation</span>
                  </div>
                </>
              )}
              <div className={styles.overviewLegend}>
                <span>
                  <i style={{ background: colors[0] }} />
                  Watch run {activeWatch + 1}
                </span>
                <span>
                  <i style={{ background: colors[1] }} />
                  External monitor
                </span>
              </div>
              <p>
                {matchedRoute(report)
                  ? "Recorded on separate runs of closely matched routes."
                  : "Recorded on separate runs."}
              </p>
            </div>
          </div>
        </section>
      )}
      {report.monitor && (
        <section className={styles.sensorMonitor}>
          <div>
            <span className={styles.micro}>Heart-rate monitor</span>
            <h2>{report.monitor.name}</h2>
            {report.monitor.description && <p>{report.monitor.description}</p>}
          </div>
          <div>
            {[
              { label: "Connection", value: report.monitor.connection },
              { label: "Worn", value: report.monitor.position },
              { label: "Sensor", value: report.monitor.sensing },
            ]
              .filter((item) => item.value)
              .map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            {report.monitor.sourceUrl && (
              <a
                href={report.monitor.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Monitor details ↗
              </a>
            )}
          </div>
        </section>
      )}
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
          Shared elapsed-time scale · recorded on separate runs.
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
        Recorded cadence across separate runs; heart-rate differences may
        reflect different efforts and conditions.
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
