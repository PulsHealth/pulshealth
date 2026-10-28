"use client";
import { forwardRef, useRef, useState } from "react";
import recorded from "@/lib/sleep-recorded.json";
import {
  parseSleepReport,
  relativeNight,
  sleepNight,
  sleepPeriod,
  sleepTime,
  SLEEP_COLORS,
  type SleepDay,
  type SleepMilestone,
  type SleepReport,
  type SleepStage,
} from "@/lib/sleep-report";
import { number } from "./report-visuals";
import { exportImage } from "./export-image";
import styles from "./examples.module.css";
const stages: SleepStage[] = [
  "awake",
  "rem",
  "core",
  "deep",
  "unspecified",
  "unknown",
];
const stageNames: Record<SleepStage, string> = {
  awake: "Awake",
  rem: "REM",
  core: "Core",
  deep: "Deep",
  unspecified: "Asleep · unstaged",
  unknown: "Unrecorded / unclear",
};
const duration = (minutes: number | null) =>
  minutes === null
    ? "—"
    : minutes >= 60
      ? sleepTime(minutes)
      : `${number(minutes, 1)} min`;
const windows = [1, 3, 7, 14, 30, 60, 90];
const initialReport = parseSleepReport(JSON.stringify(recorded));
function ribbon(day: SleepDay, width: number, height: number, domain: number) {
  return (day.segments ?? []).map((segment, i) => (
    <rect
      key={i}
      x={(segment.start / domain) * width}
      y="0"
      width={((segment.end - segment.start) / domain) * width}
      height={height}
      fill={SLEEP_COLORS[segment.stage]}
    >
      <title>
        {stageNames[segment.stage]} · {duration(segment.end - segment.start)}
      </title>
    </rect>
  ));
}
const SleepPoster = forwardRef<
  SVGSVGElement,
  { milestone: SleepMilestone; before: number; after: number; minimum: number }
>(function SleepPoster({ milestone, before, after, minimum }, ref) {
  const a = sleepPeriod(milestone, -before, 0, minimum),
    b = sleepPeriod(milestone, 0, after, minimum);
  const groups = [
    milestone.days.filter((day) => day.offset >= -before && day.offset < 0),
    milestone.days.filter((day) => day.offset >= 0 && day.offset < after),
  ];
  const domain = Math.max(
    720,
    ...groups.flat().map((day) => day.segments?.at(-1)?.end ?? 0),
  );
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1080 1350"
      role="img"
      aria-label="Sleep stages, duration and recorded awakenings before and after"
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      <rect width="1080" height="1350" fill="#101d2e" />
      <text x="72" y="100" fill="#a9bdd2" fontSize="25">
        SLEEP · BEFORE &amp; AFTER
      </text>
      <text x="64" y="225" fill="#eef4fc" fontSize="87" fontWeight="600">
        A new chapter.
      </text>
      <text x="64" y="326" fill="#74c9ff" fontSize="87" fontWeight="600">
        Night by night.
      </text>
      {[
        { x: 72, summary: a, n: before, label: "Before" },
        { x: 570, summary: b, n: after, label: "After" },
      ].map((item, i) => (
        <g key={item.x}>
          <text
            x={item.x}
            y="435"
            fill={i ? "#f5c985" : "#74c9ff"}
            fontSize="28"
          >
            {item.label} · {item.n} nights
          </text>
          <text x={item.x} y="528" fill="#eef4fc" fontSize="64">
            {sleepTime(item.summary.median)}
          </text>
          <text x={item.x} y="573" fill="#a9bdd2" fontSize="23">
            median sleep / night
          </text>
          <text x={item.x} y="638" fill="#eef4fc" fontSize="33">
            {number(item.summary.episodes, 1)} awake episodes / night
          </text>
          <text x={item.x} y="682" fill="#a9bdd2" fontSize="23">
            {duration(item.summary.awakeDuringSleep)} recorded awake / night
          </text>
        </g>
      ))}
      {groups.map((days, i) => (
        <g key={i} transform={`translate(${72 + i * 498} 750)`}>
          {days.map((day, row) => (
            <g
              key={day.offset}
              transform={`translate(0 ${(row * 280) / Math.max(days.length, 1)})`}
            >
              <rect
                width="438"
                height={Math.min(16, 250 / Math.max(days.length, 1))}
                fill="#223449"
              />
              {ribbon(
                day,
                438,
                Math.min(16, 250 / Math.max(days.length, 1)),
                domain,
              )}
            </g>
          ))}
        </g>
      ))}
      {["awake", "rem", "core", "deep"].map((stage, i) => (
        <g key={stage} transform={`translate(${72 + i * 230} 1100)`}>
          <rect
            width="16"
            height="16"
            rx="3"
            fill={SLEEP_COLORS[stage as SleepStage]}
          />
          <text x="26" y="16" fill="#a9bdd2" fontSize="22">
            {stageNames[stage as SleepStage]}
          </text>
        </g>
      ))}
      <text x="72" y="1162" fill="#a9bdd2" fontSize="22">
        One row per night · stages aligned by elapsed sleep-session time
      </text>
      <text x="72" y="1212" fill="#a9bdd2" fontSize="22">
        {minimum === 0
          ? "All recorded awake episodes"
          : `Awake episodes ≥ ${minimum} min`}{" "}
        · {a.count}/{a.available} before and {b.count}/{b.available} after
        recorded
      </text>
      <text x="72" y="1300" fill="#a9bdd2" fontSize="18">
        Made with PulsHealth
      </text>
    </svg>
  );
});
export function SleepReview({ compact = false }: { compact?: boolean }) {
  const [report, setReport] = useState<SleepReport>(initialReport),
    [before, setBefore] = useState(14),
    [after, setAfter] = useState(14),
    [minimum, setMinimum] = useState(1),
    [chosen, setChosen] = useState(0),
    [status, setStatus] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const inspectNight = (offset: number) => {
    setChosen(offset);
    requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      }),
    );
  };
  const poster = useRef<SVGSVGElement>(null),
    milestone = report.milestones[0],
    a = sleepPeriod(milestone, -before, 0, minimum),
    b = sleepPeriod(milestone, 0, after, minimum);
  const visible = milestone.days.filter(
      (day) => day.offset >= -before && day.offset < after,
    ),
    selected =
      visible.find((day) => day.offset === chosen && day.minutes !== null) ??
      visible.find((day) => day.offset >= 0 && day.minutes !== null) ??
      visible.find((day) => day.minutes !== null),
    detail = selected ? sleepNight(selected, minimum) : null;
  const domain = Math.max(
    720,
    ...visible.map((day) => day.segments?.at(-1)?.end ?? 0),
  );
  const dayAt = (offset: number) =>
    milestone.days.find((day) => day.offset === offset);
  if (compact)
    return (
      <SleepPoster
        milestone={milestone}
        before={before}
        after={after}
        minimum={minimum}
      />
    );
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
                    setChosen(0);
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
            <a href="https://github.com/PulsHealth/pulshealth/tree/main/examples/showcase">
              File format and adapter
            </a>
            <button
              onClick={() => {
                setReport(initialReport);
                setChosen(0);
              }}
            >
              Reset example
            </button>
          </div>
        </details>
      </div>
      <header className={styles.analysisHero}>
        <h2>
          A new chapter.
          <br />
          <span>Night by night.</span>
        </h2>
        <div className={styles.sectionStats}>
          <div>
            <strong>{sleepTime(a.median)}</strong>
            <span>median sleep before</span>
          </div>
          <div>
            <strong style={{ color: "#f5c985" }}>{sleepTime(b.median)}</strong>
            <span>median sleep after</span>
          </div>
        </div>
      </header>
      <div className={styles.traceOptions}>
        <label className={styles.baseline}>
          Before
          <select
            aria-label="Nights before"
            value={before}
            onChange={(e) => setBefore(Number(e.target.value))}
          >
            {windows.map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "night" : "nights"}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.baseline}>
          After
          <select
            aria-label="Nights after"
            value={after}
            onChange={(e) => setAfter(Number(e.target.value))}
          >
            {windows.map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "night" : "nights"}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.baseline}>
          Count awake episodes
          <select
            aria-label="Minimum awake episode"
            value={minimum}
            onChange={(e) => setMinimum(Number(e.target.value))}
          >
            <option value="0">Any duration</option>
            <option value="1">1+ minute</option>
            <option value="5">5+ minutes</option>
          </select>
        </label>
      </div>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>See how each night unfolded</h2>
          <span>Select a night for the stage detail</span>
        </div>
        <div className={styles.sleepStageLegend}>
          {stages.map((stage) => (
            <span key={stage}>
              <i style={{ background: SLEEP_COLORS[stage] }} />
              {stageNames[stage]}
            </span>
          ))}
        </div>
        <div className={styles.sleepNightGrid}>
          {[
            {
              title: "Before",
              offsets: Array.from({ length: before }, (_, i) => i - before),
            },
            {
              title: "After",
              offsets: Array.from({ length: after }, (_, i) => i),
            },
          ].map((group) => (
            <div key={group.title}>
              <h3>{group.title}</h3>
              <div className={styles.nightScale}>
                <span>Night</span>
                <span>0 → {number(domain / 60)} elapsed hours</span>
                <span>Sleep · wakes</span>
              </div>
              {group.offsets.map((offset) => {
                const day = dayAt(offset),
                  stats = day ? sleepNight(day, minimum) : null;
                return (
                  <button
                    className={styles.sleepNightRow}
                    key={offset}
                    disabled={!day || day.minutes === null}
                    aria-pressed={selected?.offset === offset}
                    aria-label={`${relativeNight(offset)}, ${sleepTime(day?.minutes ?? null)}, ${number(stats?.episodes ?? null)} counted awake episodes`}
                    onClick={() => inspectNight(offset)}
                  >
                    <span>{offset < 0 ? -offset : offset + 1}</span>
                    <svg
                      viewBox="0 0 720 24"
                      role="img"
                      aria-label={`${relativeNight(offset)} sleep stages`}
                    >
                      <rect width="720" height="24" fill="#223449" />
                      {day && ribbon(day, 720, 24, domain)}
                    </svg>
                    <span>
                      {sleepTime(day?.minutes ?? null)}
                      <small>{number(stats?.episodes ?? null)} wakes</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>
      {selected && detail && (
        <section
          ref={detailRef}
          className={`${styles.reportSection} ${styles.sleepNightDetail}`}
        >
          <div className={styles.sectionTitle}>
            <h2>{relativeNight(selected.offset)}</h2>
            <span>{sleepTime(selected.minutes)} recorded sleep</span>
          </div>
          <svg
            viewBox="0 0 960 270"
            role="img"
            aria-label="Selected night sleep stage timeline, elapsed hours"
          >
            {stages.map((stage, i) => (
              <g key={stage}>
                <text
                  x="4"
                  y={42 + i * 32}
                  fill={SLEEP_COLORS[stage]}
                  fontSize="12"
                >
                  {stageNames[stage]}
                </text>
                <line
                  x1="145"
                  x2="930"
                  y1={38 + i * 32}
                  y2={38 + i * 32}
                  stroke="#2b4056"
                />
              </g>
            ))}
            {(selected.segments ?? []).map((segment, i) => (
              <rect
                key={i}
                x={
                  145 +
                  (segment.start / (selected.segments?.at(-1)?.end || 720)) *
                    785
                }
                y={25 + stages.indexOf(segment.stage) * 32}
                width={Math.max(
                  0.6,
                  ((segment.end - segment.start) /
                    (selected.segments?.at(-1)?.end || 720)) *
                    785,
                )}
                height="23"
                fill={SLEEP_COLORS[segment.stage]}
              >
                <title>
                  {stageNames[segment.stage]} ·{" "}
                  {duration(segment.end - segment.start)}
                </title>
              </rect>
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <text
                key={t}
                x={145 + t * 785}
                y="244"
                textAnchor="middle"
                fill="#a9bdd2"
                fontSize="12"
              >
                {number((t * (selected.segments?.at(-1)?.end ?? 0)) / 60, 1)} h
              </text>
            ))}
          </svg>
          {!selected.segments?.length && (
            <p className={styles.shortNote}>
              No stage intervals recorded for this night.
            </p>
          )}
          <div className={styles.nightDetailStats}>
            {[
              {
                label: "Counted awake episodes",
                value: number(detail.episodes),
              },
              {
                label: "Recorded awake time",
                value: duration(detail.awakeMinutes),
              },
              {
                label: "Longest counted awake episode",
                value: duration(detail.longestWake),
              },
              {
                label: "Longest recorded sleep stretch",
                value: sleepTime(detail.longestSleep),
              },
              { label: "REM", value: sleepTime(detail.rem) },
              { label: "Deep", value: sleepTime(detail.deep) },
            ].map((item) => (
              <div key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className={styles.sleepHighlights}>
        <div>
          <strong>
            {number(a.episodes, 1)} → {number(b.episodes, 1)}
          </strong>
          <span>median counted awake episodes / night</span>
        </div>
        <div>
          <strong>
            {duration(a.awakeDuringSleep)} → {duration(b.awakeDuringSleep)}
          </strong>
          <span>median recorded awake time / night</span>
        </div>
        <div>
          <strong>
            {sleepTime(a.longestSleep)} → {sleepTime(b.longestSleep)}
          </strong>
          <span>median longest recorded sleep stretch</span>
        </div>
      </div>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>Before &amp; after, side by side</h2>
          <span>Medians across recorded nights</span>
        </div>
        <div className={styles.intervalTable}>
          <table>
            <thead>
              <tr>
                <th>Per-night measure</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: "Sleep duration",
                  values: [sleepTime(a.median), sleepTime(b.median)],
                },
                {
                  label: "Middle half of sleep durations",
                  values: [
                    `${sleepTime(a.lower)}–${sleepTime(a.upper)}`,
                    `${sleepTime(b.lower)}–${sleepTime(b.upper)}`,
                  ],
                },
                {
                  label: "Counted awake episodes",
                  values: [number(a.episodes, 1), number(b.episodes, 1)],
                },
                {
                  label: "Recorded awake time",
                  values: [
                    duration(a.awakeDuringSleep),
                    duration(b.awakeDuringSleep),
                  ],
                },
                {
                  label: "Typical counted episode length",
                  values: [
                    duration(a.episodeLength),
                    duration(b.episodeLength),
                  ],
                },
                {
                  label: "Longest counted awake episode",
                  values: [duration(a.longestWake), duration(b.longestWake)],
                },
                {
                  label: "Longest recorded sleep stretch",
                  values: [
                    sleepTime(a.longestSleep),
                    sleepTime(b.longestSleep),
                  ],
                },
                {
                  label: "Core sleep",
                  values: [sleepTime(a.core), sleepTime(b.core)],
                },
                {
                  label: "REM sleep",
                  values: [sleepTime(a.rem), sleepTime(b.rem)],
                },
                {
                  label: "Deep sleep",
                  values: [sleepTime(a.deep), sleepTime(b.deep)],
                },
                {
                  label: "Nights under 6 hours",
                  values: [`${number(a.short)}%`, `${number(b.short)}%`],
                },
                {
                  label: "Recorded nights / window",
                  values: [
                    `${a.count}/${a.available}`,
                    `${b.count}/${b.available}`,
                  ],
                },
                {
                  label: "Nights with interruption records",
                  values: [
                    number(a.episodeCoverage),
                    number(b.episodeCoverage),
                  ],
                },
              ].map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.values[0]}</td>
                  <td>{row.values[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.micro}>
          Typical episode length is the median of all counted episodes; other
          measures summarize each night first.
        </p>
      </section>
      <section className={styles.reportSection}>
        <h2>Compare night by night</h2>
        <div className={styles.intervalTable}>
          <table>
            <thead>
              <tr>
                <th>Night from arrival</th>
                <th>Before sleep</th>
                <th>After sleep</th>
                <th>Before wakes</th>
                <th>After wakes</th>
                <th>Before awake</th>
                <th>After awake</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(before, after) }, (_, i) => {
                const pre = i < before ? dayAt(-i - 1) : undefined,
                  post = i < after ? dayAt(i) : undefined,
                  preStats = pre ? sleepNight(pre, minimum) : null,
                  postStats = post ? sleepNight(post, minimum) : null;
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <button
                        disabled={!pre || pre.minutes === null}
                        onClick={() => inspectNight(-i - 1)}
                      >
                        {sleepTime(pre?.minutes ?? null)}
                      </button>
                    </td>
                    <td>
                      <button
                        disabled={!post || post.minutes === null}
                        onClick={() => inspectNight(i)}
                      >
                        {sleepTime(post?.minutes ?? null)}
                      </button>
                    </td>
                    <td>{number(preStats?.episodes ?? null)}</td>
                    <td>{number(postStats?.episodes ?? null)}</td>
                    <td>{duration(preStats?.awakeMinutes ?? null)}</td>
                    <td>{duration(postStats?.awakeMinutes ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
        Awake episodes count recorded wakefulness between sleep periods.
        Unrecorded gaps are not counted as awakenings. Each night uses one
        consistent sleep source. Calendar dates and identifying details are
        omitted.
      </p>
      <div className={styles.exportOnly} aria-hidden="true">
        <SleepPoster
          ref={poster}
          milestone={milestone}
          before={before}
          after={after}
          minimum={minimum}
        />
      </div>
    </div>
  );
}
