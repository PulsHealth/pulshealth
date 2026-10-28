"use client";
import { forwardRef, useRef, useState } from "react";
import recorded from "@/lib/sleep-recorded.json";
import {
  parseSleepReport,
  sleepPeriod,
  sleepTime,
  type SleepMilestone,
  type SleepReport,
} from "@/lib/sleep-report";
import { number } from "./report-visuals";
import { exportImage } from "./export-image";
import styles from "./examples.module.css";
const blue = "#74c9ff",
  gold = "#f5c985";
const periods = [
  { label: "Before", start: -90, end: 0 },
  { label: "First month", start: 0, end: 30 },
  { label: "Months 2–3", start: 30, end: 90 },
  { label: "Months 4–6", start: 90, end: 180 },
  { label: "Months 7–12", start: 180, end: 365 },
];
const SleepPoster = forwardRef<
  SVGSVGElement,
  { milestone: SleepMilestone; before: number; after: number }
>(function SleepPoster({ milestone, before, after }, ref) {
  const a = sleepPeriod(milestone, -before, 0),
    b = sleepPeriod(milestone, 0, after);
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1080 1350"
      role="img"
      aria-label="Sleep before and after a family milestone"
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      <rect width="1080" height="1350" fill="#101d2e" />
      <text x="72" y="100" fill="#a9bdd2" fontSize="25">
        A NEW CHAPTER · {milestone.label.toUpperCase()}
      </text>
      <text x="64" y="235" fill="#eef4fc" fontSize="94" fontWeight="600">
        Different days.
      </text>
      <text x="64" y="343" fill={gold} fontSize="94" fontWeight="600">
        Different nights.
      </text>
      {[
        { x: 72, summary: a, color: blue, label: `${before} days before` },
        { x: 570, summary: b, color: gold, label: `${after} days after` },
      ].map((item) => (
        <g key={item.x}>
          <text x={item.x} y="530" fill={item.color} fontSize="66">
            {sleepTime(item.summary.median)}
          </text>
          <text x={item.x} y="585" fill="#a9bdd2" fontSize="27">
            {item.label}
          </text>
          <text x={item.x} y="630" fill="#a9bdd2" fontSize="22">
            {item.summary.count}/{item.summary.available} nights recorded
          </text>
        </g>
      ))}
      {milestone.days
        .filter(
          (d) =>
            d.offset >= -before &&
            d.offset < Math.min(after, milestone.availableThrough + 1),
        )
        .map((day) => {
          const x = 72 + ((day.offset + before) / (before + after)) * 936,
            h = day.minutes === null ? 0 : Math.min(day.minutes / 720, 1) * 260;
          return (
            <rect
              key={day.offset}
              x={x}
              y={1000 - h}
              width={Math.max(1, 936 / (before + after) - 1)}
              height={h}
              fill={day.offset < 0 ? blue : gold}
              opacity=".8"
            />
          );
        })}
      <line
        x1={72 + (before / (before + after)) * 936}
        x2={72 + (before / (before + after)) * 936}
        y1="710"
        y2="1020"
        stroke="#eef4fc"
        strokeDasharray="6 6"
      />
      <text x="72" y="1090" fill="#a9bdd2" fontSize="25">
        Each bar is one recorded main sleep session.
      </text>
      <text x="72" y="1150" fill="#eef4fc" fontSize="30">
        Median sleep before and after a family milestone.
      </text>
      <text x="72" y="1205" fill="#a9bdd2" fontSize="23">
        Missing nights stay missing. Timing alone does not establish cause.
      </text>
      <text x="72" y="1300" fill="#a9bdd2" fontSize="18">
        Made with PulsHealth
      </text>
    </svg>
  );
});
export function SleepReview({ compact = false }: { compact?: boolean }) {
  const [report, setReport] = useState<SleepReport>(recorded),
    [index, setIndex] = useState(0),
    [before, setBefore] = useState(90),
    [after, setAfter] = useState(90),
    [status, setStatus] = useState("");
  const poster = useRef<SVGSVGElement>(null),
    milestone = report.milestones[index],
    a = sleepPeriod(milestone, -before, 0),
    b = sleepPeriod(milestone, 0, after),
    difference =
      a.median === null || b.median === null ? null : b.median - a.median;
  if (compact)
    return <SleepPoster milestone={milestone} before={before} after={after} />;
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
                    if (file.size > 1000000)
                      throw new Error("Use a file smaller than 1 MB.");
                    setReport(parseSleepReport(await file.text()));
                    setIndex(0);
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
                setReport(recorded);
                setIndex(0);
              }}
            >
              Reset example
            </button>
          </div>
        </details>
      </div>
      <header className={styles.analysisHero}>
        <h2>
          New chapters.
          <br />
          <span>Different nights.</span>
        </h2>
        <div className={styles.sectionStats}>
          <div>
            <strong>{sleepTime(a.median)}</strong>
            <span>median sleep before</span>
          </div>
          <div>
            <strong style={{ color: gold }}>{sleepTime(b.median)}</strong>
            <span>median sleep after</span>
          </div>
        </div>
      </header>
      <div className={styles.traceOptions}>
        <div className={styles.segment}>
          {report.milestones.map((m, i) => (
            <button
              key={i}
              aria-pressed={index === i}
              onClick={() => setIndex(i)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className={styles.baseline}>
          Baseline
          <select
            value={before}
            onChange={(e) => setBefore(Number(e.target.value))}
          >
            {[30, 90, 180].map((n) => (
              <option key={n} value={n}>
                {n} days before
              </option>
            ))}
          </select>
        </label>
        <label className={styles.baseline}>
          Compare
          <select
            value={after}
            onChange={(e) => setAfter(Number(e.target.value))}
          >
            {[30, 90, 180, 365].map((n) => (
              <option key={n} value={n}>
                {n} days after
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.sleepHighlights}>
        <div>
          <strong>
            {difference === null
              ? "—"
              : `${difference > 0 ? "+" : "−"}${number(Math.abs(difference))} min`}
          </strong>
          <span>change in median main sleep</span>
        </div>
        <div>
          <strong>
            {number(a.short)}% → {number(b.short)}%
          </strong>
          <span>recorded nights under 6 hours</span>
        </div>
        <div>
          <strong>
            {a.count} / {a.available} → {b.count} / {b.available}
          </strong>
          <span>nights recorded in each window</span>
        </div>
      </div>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>Every night tells part of it</h2>
          <span>{milestone.label} · daily sleep</span>
        </div>
        <svg
          viewBox="0 0 960 340"
          role="img"
          aria-label="Daily main sleep duration before and after the selected milestone"
        >
          {[0, 3, 6, 9, 12].map((h) => (
            <g key={h}>
              <line
                x1="50"
                x2="930"
                y1={270 - (h / 12) * 230}
                y2={270 - (h / 12) * 230}
                stroke="#2b4056"
              />
              <text
                x="40"
                y={274 - (h / 12) * 230}
                textAnchor="end"
                fill="#a9bdd2"
                fontSize="12"
              >
                {h}h
              </text>
            </g>
          ))}
          {milestone.days
            .filter((day) => day.offset >= -before && day.offset < after)
            .map((day) => {
              const x = 50 + ((day.offset + before) / (before + after)) * 880;
              return day.minutes === null ? (
                <line
                  key={day.offset}
                  x1={x}
                  x2={x}
                  y1="274"
                  y2="278"
                  stroke="#5d7084"
                />
              ) : (
                <rect
                  key={day.offset}
                  x={x}
                  y={270 - Math.min(day.minutes / 720, 1) * 230}
                  width={Math.max(0.7, 880 / (before + after) - 0.7)}
                  height={Math.min(day.minutes / 720, 1) * 230}
                  fill={day.offset < 0 ? blue : gold}
                  opacity=".8"
                >
                  <title>
                    {day.offset < 0
                      ? `${-day.offset} days before`
                      : `Day ${day.offset} after`}
                    : {sleepTime(day.minutes)}
                  </title>
                </rect>
              );
            })}
          <line
            x1={50 + (before / (before + after)) * 880}
            x2={50 + (before / (before + after)) * 880}
            y1="20"
            y2="280"
            stroke="#eef4fc"
            strokeDasharray="4 4"
          />
          <text x="50" y="310" fill={blue} fontSize="14">
            {before} days before
          </text>
          <text
            x={50 + (before / (before + after)) * 880 + 8}
            y="32"
            fill="#eef4fc"
            fontSize="13"
          >
            Arrival
          </text>
          <text x="930" y="310" fill={gold} fontSize="14" textAnchor="end">
            {Math.min(after, milestone.availableThrough + 1)} days observed
            after
          </text>
        </svg>
        <p className={styles.micro}>
          Main sleep session per wake-up day. Missing nights appear as gaps;
          chart height is capped at 12 hours.
        </p>
      </section>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>More than the average</h2>
          <span>Before and after, side by side</span>
        </div>
        <div className={styles.headToHead}>
          {[
            { label: "Before", summary: a, color: blue },
            { label: "After", summary: b, color: gold },
          ].map((item) => (
            <article key={item.label} style={{ borderTopColor: item.color }}>
              <h3>{item.label}</h3>
              <strong className={styles.headPace} style={{ color: item.color }}>
                {sleepTime(item.summary.median)}
              </strong>
              <dl>
                <div>
                  <dt>Middle half of nights</dt>
                  <dd>
                    {sleepTime(item.summary.lower)}–
                    {sleepTime(item.summary.upper)}
                  </dd>
                </div>
                <div>
                  <dt>Nights under 6h</dt>
                  <dd>{number(item.summary.short)}%</dd>
                </div>
                <div>
                  <dt>Median recorded awake time</dt>
                  <dd>{number(item.summary.awake)} min</dd>
                </div>
                <div>
                  <dt>Awake-time coverage</dt>
                  <dd>{item.summary.awakeCount} nights</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
        <p className={styles.micro}>
          Awake time covers recorded wakefulness within the main session. It
          does not capture every overnight interruption.
        </p>
      </section>
      <section className={styles.reportSection}>
        <div className={styles.sectionTitle}>
          <h2>The months that followed</h2>
          <span>Median main sleep · matched relative windows</span>
        </div>
        <div className={styles.sleepTimeline}>
          {report.milestones.map((m) => (
            <div key={m.label}>
              <h3>{m.label}</h3>
              {periods.map((period) => {
                const summary = sleepPeriod(m, period.start, period.end);
                return (
                  <div className={styles.sleepPeriod} key={period.label}>
                    <span>{period.label}</span>
                    <div>
                      <i
                        style={{
                          width: `${Math.min((summary.median ?? 0) / 600, 1) * 100}%`,
                          background: period.start < 0 ? blue : gold,
                        }}
                      />
                    </div>
                    <strong>{sleepTime(summary.median)}</strong>
                    <small>
                      {summary.count}/{summary.available} nights
                    </small>
                  </div>
                );
              })}
            </div>
          ))}
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
                      "sleep-new-chapters",
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
        Changes coincide with family milestones. Other routines, recording
        coverage and life changes may also affect the pattern.
      </p>
      <div className={styles.exportOnly} aria-hidden="true">
        <SleepPoster
          ref={poster}
          milestone={milestone}
          before={before}
          after={after}
        />
      </div>
    </div>
  );
}
