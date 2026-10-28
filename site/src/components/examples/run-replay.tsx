"use client";
import { useEffect, useMemo, useState } from "react";
import type { RouteComparison } from "@/lib/route-comparisons";
import { MONTH_NAMES } from "@/lib/example-report";
import { number } from "./report-visuals";
import styles from "./examples.module.css";

type Run = RouteComparison["attempts"][number];
const color = (i: number) => `hsl(${(i * 137.508 + 195) % 360} 80% 72%)`;
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const pace = (run: Run) => clock((run.minutes * 60) / (run.km * 0.621371192));
function lengths(track: NonNullable<Run["track"]>) {
  let sum = 0;
  return track.map((p, i) => {
    if (i) sum += Math.hypot(p.x - track[i - 1].x, p.y - track[i - 1].y);
    return sum;
  });
}
export function trackPosition(
  track: NonNullable<Run["track"]>,
  distances: number[],
  seconds: number,
) {
  if (!track.length) return null;
  if (seconds < track[0].seconds) return null;
  const last = track.length - 1;
  if (seconds >= track[last].seconds)
    return { ...track[last], progress: 1, finished: true };
  const index = track.findIndex((p) => p.seconds > seconds),
    a = track[index - 1],
    b = track[index];
  if (seconds === a.seconds)
    return {
      ...a,
      progress: distances[index - 1] / (distances[last] || 1),
      finished: false,
    };
  if (b.seconds - a.seconds > 120) return null;
  const t = (seconds - a.seconds) / (b.seconds - a.seconds);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    progress:
      (distances[index - 1] + (distances[index] - distances[index - 1]) * t) /
      (distances[last] || 1),
    finished: false,
  };
}

export function RunReplay({
  group,
  selected,
  baseline,
}: {
  group: RouteComparison;
  selected: number;
  baseline: number;
}) {
  const [race, setRace] = useState({ elapsed: 0, playing: false }),
    [speed, setSpeed] = useState(120),
    [metric, setMetric] = useState<"heartRate" | "powerW" | "speedMps">(
      "heartRate",
    ),
    [axis, setAxis] = useState<"time" | "progress">("time"),
    [all, setAll] = useState(false);
  const { elapsed, playing } = race;
  const setElapsed = (elapsed: number) =>
    setRace((state) => ({ ...state, elapsed }));
  const setPlaying = (playing: boolean) =>
    setRace((state) => ({ ...state, playing }));
  const tracks = useMemo(
    () =>
      group.attempts.map((run, i) => ({
        run,
        i,
        distances: run.track ? lengths(run.track) : [],
      })),
    [group],
  );
  const end = Math.max(
    0,
    ...group.attempts.map((run) => run.track?.at(-1)?.seconds ?? 0),
  );
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) {
        const advance = Math.min((now - last) / 1000, 0.25) * speed;
        setRace((state) => {
          const elapsed = Math.min(end, state.elapsed + advance);
          return { elapsed, playing: elapsed < end };
        });
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, end]);
  const active = tracks.filter(
      ({ i }) => all || i === selected || i === baseline,
    ),
    unit = metric === "heartRate" ? "bpm" : metric === "powerW" ? "W" : "mph",
    metricName =
      metric === "heartRate"
        ? "Heart rate"
        : metric === "powerW"
          ? "Running power"
          : "Running speed";
  const traces = active.map(({ run, i, distances }) => ({
    i,
    points: (run.streams?.[metric] ?? []).flatMap((p) => {
      const position = run.track
        ? trackPosition(run.track, distances, p.seconds)
        : null;
      if (
        axis === "progress" &&
        (!position || p.seconds > run.track!.at(-1)!.seconds)
      )
        return [];
      return [
        {
          seconds: p.seconds,
          x: axis === "time" ? p.seconds : position!.progress * 100,
          value: p.value * (metric === "speedMps" ? 2.236936292 : 1),
        },
      ];
    }),
  }));
  const values = traces.flatMap((trace) => trace.points.map((p) => p.value)),
    low = values.length
      ? Math.floor(values.reduce((a, b) => Math.min(a, b), Infinity) / 10) * 10
      : 0,
    high = values.length
      ? Math.ceil(values.reduce((a, b) => Math.max(a, b), -Infinity) / 10) * 10
      : 1;
  const xmax =
      axis === "progress"
        ? 100
        : traces.reduce(
            (max, trace) =>
              trace.points.reduce((max, p) => Math.max(max, p.x), max),
            1,
          ),
    px = (x: number) => 55 + (x / xmax) * 870,
    py = (v: number) => 245 - ((v - low) / (high - low || 1)) * 195;
  const leaderboard = tracks
    .map(({ run, i, distances }) => ({
      i,
      position: run.track ? trackPosition(run.track, distances, elapsed) : null,
      finish: run.track?.at(-1)?.seconds ?? Infinity,
    }))
    .sort(
      (a, b) =>
        (b.position?.progress ?? 0) - (a.position?.progress ?? 0) ||
        a.finish - b.finish,
    );
  return (
    <>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>Head to head</h2>
          <span>Recorded workout measurements</span>
        </div>
        <div className={styles.headToHead}>
          {[baseline, selected].map((index, column) => {
            const run = group.attempts[index],
              m = run.metrics;
            return (
              <article key={column} style={{ borderTopColor: color(index) }}>
                <span className={styles.micro}>
                  {column === 0 ? "Baseline" : "Selected effort"}
                </span>
                <h3>
                  Run {index + 1} · {MONTH_NAMES[run.month - 1]}
                </h3>
                <strong
                  className={styles.headPace}
                  style={{ color: color(index) }}
                >
                  {pace(run)}
                  <small> /mi</small>
                </strong>
                <dl>
                  {[
                    ["Distance", `${number(run.km * 0.621371192, 2)} mi`],
                    ["Duration", clock(run.minutes * 60)],
                    [
                      "Heart rate",
                      `${number(m?.heartRate ?? null)}${m?.heartRate === undefined ? "" : " bpm"}`,
                    ],
                    [
                      "Running power",
                      `${number(m?.powerW ?? null)}${m?.powerW === undefined ? "" : " W"}`,
                    ],
                    [
                      "Stride length",
                      `${number(m?.strideM === undefined ? null : m.strideM * 3.280839895, 2)}${m?.strideM === undefined ? "" : " ft"}`,
                    ],
                    [
                      "Ground contact",
                      `${number(m?.groundContactMs ?? null)}${m?.groundContactMs === undefined ? "" : " ms"}`,
                    ],
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
      </section>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>Overlay the effort</h2>
          <div className={styles.segment}>
            {(["heartRate", "powerW", "speedMps"] as const).map((key) => (
              <button
                key={key}
                aria-pressed={metric === key}
                onClick={() => setMetric(key)}
              >
                {key === "heartRate"
                  ? "Heart rate"
                  : key === "powerW"
                    ? "Power"
                    : "Speed"}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.traceOptions}>
          <div className={styles.segment}>
            <button
              aria-pressed={axis === "time"}
              onClick={() => setAxis("time")}
            >
              Elapsed time
            </button>
            <button
              aria-pressed={axis === "progress"}
              onClick={() => setAxis("progress")}
            >
              Route progress
            </button>
          </div>
          <label>
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            Overlay all runs
          </label>
        </div>
        {values.length ? (
          <svg
            viewBox="0 0 960 300"
            role="img"
            aria-label={`${metricName} overlay by ${axis === "time" ? "elapsed time" : "GPS route progress"}`}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line
                  x1="55"
                  x2="925"
                  y1={py(low + t * (high - low))}
                  y2={py(low + t * (high - low))}
                  stroke="#2b4056"
                />
                <text
                  x="45"
                  y={py(low + t * (high - low)) + 4}
                  textAnchor="end"
                  fill="#a9bdd2"
                  fontSize="12"
                >
                  {number(low + t * (high - low))}
                </text>
                <text
                  x={px(t * xmax)}
                  y="274"
                  textAnchor="middle"
                  fill="#a9bdd2"
                  fontSize="12"
                >
                  {axis === "time"
                    ? clock(t * xmax)
                    : `${Math.round(t * 100)}%`}
                </text>
              </g>
            ))}
            <text x="55" y="23" fill="#a9bdd2" fontSize="13">
              {metricName} · {unit}
            </text>
            {traces.map((trace) => (
              <path
                key={trace.i}
                d={trace.points
                  .map(
                    (p, i) =>
                      `${!i || p.seconds - trace.points[i - 1].seconds > 90 ? "M" : "L"}${px(p.x)},${py(p.value)}`,
                  )
                  .join(" ")}
                fill="none"
                stroke={color(trace.i)}
                strokeWidth={
                  trace.i === selected || trace.i === baseline ? 2.5 : 1.3
                }
                opacity={trace.i === selected || trace.i === baseline ? 1 : 0.4}
              />
            ))}
            {axis === "time" && elapsed <= xmax && (
              <line
                x1={px(elapsed)}
                x2={px(elapsed)}
                y1="40"
                y2="245"
                stroke="#f5c985"
                strokeDasharray="4 4"
              />
            )}
          </svg>
        ) : (
          <p className={styles.shortNote}>
            No recorded {metricName.toLowerCase()} stream for these runs.
          </p>
        )}
        <div className={styles.replayLegend}>
          {active.map(({ i }) => (
            <span key={i}>
              <i style={{ background: color(i) }} />
              Run {i + 1}
            </span>
          ))}
        </div>
        <p className={styles.micro}>
          Recorded metric samples. Gaps stay visible. GPS progress follows each
          run&apos;s sampled track.
        </p>
      </section>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>Race your past runs</h2>
          <strong className={styles.replayClock}>{clock(elapsed)}</strong>
        </div>
        {end > 0 ? (
          <>
            <div className={styles.replayControls}>
              <button
                className={styles.primaryButton}
                onClick={() => {
                  if (elapsed >= end) setElapsed(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? "Pause" : "Play race"}
              </button>
              <button
                onClick={() => {
                  setPlaying(false);
                  setElapsed(0);
                }}
              >
                Restart
              </button>
              <label>
                Speed
                <select
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  {[30, 60, 120, 240].map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </select>
              </label>
              <input
                aria-label="Race elapsed seconds"
                type="range"
                min="0"
                max={Math.ceil(end)}
                step="1"
                value={elapsed}
                onChange={(e) => {
                  setPlaying(false);
                  setElapsed(Number(e.target.value));
                }}
              />
            </div>
            <div className={styles.replayGrid}>
              <svg
                viewBox="0 0 720 420"
                role="img"
                aria-label={`Synchronized GPS replay at ${clock(elapsed)} elapsed`}
              >
                {tracks.map(({ run, i }) => (
                  <path
                    key={i}
                    d={run.path}
                    fill="none"
                    stroke={color(i)}
                    strokeWidth="1"
                    opacity=".16"
                  />
                ))}
                {tracks.map(({ run, i, distances }) => {
                  const p = run.track
                    ? trackPosition(run.track, distances, elapsed)
                    : null;
                  return p ? (
                    <g key={i}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={i === selected ? 6 : 4}
                        fill={color(i)}
                        stroke="#101d2e"
                        strokeWidth="1.5"
                      />
                      <text
                        x={p.x + 7}
                        y={p.y - 6}
                        fill={color(i)}
                        fontSize="9"
                      >
                        {i + 1}
                      </text>
                    </g>
                  ) : null;
                })}
              </svg>
              <div className={styles.replayStandings}>
                {leaderboard.map(({ i, position }) => (
                  <div key={i}>
                    <span style={{ color: color(i) }}>Run {i + 1}</span>
                    <strong>
                      {position
                        ? position.finished
                          ? "Track end"
                          : `${number(position.progress * 100)}%`
                        : elapsed <
                            (group.attempts[i].track?.[0]?.seconds ?? Infinity)
                          ? "Awaiting GPS"
                          : "GPS gap"}
                    </strong>
                    <i
                      style={{
                        width: `${(position?.progress ?? 0) * 100}%`,
                        background: color(i),
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <p className={styles.micro}>
              All runs start together at workout time zero. Positions
              interpolate between recorded GPS samples up to two minutes apart;
              longer gaps hide the marker. Progress follows each recorded track.
              GPS elapsed time can include pauses. Standings rank GPS progress,
              then time to the end of the recorded track.
            </p>
          </>
        ) : (
          <p className={styles.shortNote}>
            Add elapsed seconds to route points to replay recorded positions.
          </p>
        )}
      </section>
    </>
  );
}
