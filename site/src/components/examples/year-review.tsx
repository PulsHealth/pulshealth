"use client";
import { useRef, useState } from "react";
import { monthlyHealth, yearMetrics, type Report } from "@/lib/example-report";
import {
  YearPoster,
  ActivityHeatmap,
  ActivityMix,
  SleepSummary,
  HeartSummary,
  MonthBars,
  number,
  hours,
} from "./report-visuals";
import { exportImage } from "./export-image";
import styles from "./examples.module.css";
export function YearReview({
  report,
  compact = false,
}: {
  report: Report;
  compact?: boolean;
}) {
  const [format, setFormat] = useState<"portrait" | "square" | "story">(
      "portrait",
    ),
    [theme, setTheme] = useState<"night" | "paper">("night"),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const svg = useRef<SVGSVGElement>(null),
    m = yearMetrics(report);
  async function image(share = false) {
    if (!svg.current) return;
    setBusy(true);
    try {
      setStatus(
        await exportImage(svg.current, `health-year-${report.year}`, share),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not save your image.");
    } finally {
      setBusy(false);
    }
  }
  if (compact)
    return <YearPoster report={report} format="portrait" theme="night" />;
  return (
    <>
      <div className={styles.studio}>
        <div className={styles.artwork}>
          <YearPoster ref={svg} report={report} format={format} theme={theme} />
        </div>
        <aside className={styles.editor}>
          <h2>
            A year worth
            <br />
            keeping.
          </h2>
          <p className={styles.shortNote}>
            A ready-to-post snapshot of movement, sleep, and the days in
            between.
          </p>
          <fieldset>
            <legend>Image format</legend>
            <div className={styles.segment}>
              {(
                [
                  ["portrait", "Post"],
                  ["story", "Story"],
                  ["square", "Square"],
                ] as const
              ).map(([key, label]) => (
                <button
                  aria-pressed={format === key}
                  key={key}
                  onClick={() => setFormat(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Appearance</legend>
            <div className={styles.segment}>
              <button
                aria-pressed={theme === "night"}
                onClick={() => setTheme("night")}
              >
                Night
              </button>
              <button
                aria-pressed={theme === "paper"}
                onClick={() => setTheme("paper")}
              >
                Paper
              </button>
            </div>
          </fieldset>
          <div className={styles.exportButtons}>
            <button
              className={styles.primaryButton}
              disabled={busy}
              onClick={() => image()}
            >
              Save image
            </button>
            <button disabled={busy} onClick={() => image(true)}>
              Share
            </button>
          </div>
          <p role="status" className={styles.status}>
            {status}
          </p>
          <a href="#year-details" className={styles.textLink}>
            Explore the full year
          </a>
        </aside>
      </div>
      <div id="year-details" className={styles.reportGrid}>
        {m.stepDays > 0 && (
          <section className={`${styles.reportSection} ${styles.wideSection}`}>
            <div className={styles.sectionTitle}>
              <h2>The everyday miles.</h2>
              <span>{report.year}</span>
            </div>
            <div className={styles.sectionStats}>
              <div>
                <strong>{number(m.steps)}</strong>
                <span>recorded steps</span>
              </div>
              <div>
                <strong>{number(m.avgSteps)}</strong>
                <span>steps per recorded day</span>
              </div>
              <div>
                <strong>{m.tenKDays}</strong>
                <span>days past 10,000</span>
              </div>
              <div>
                <strong>{number(m.maxSteps)}</strong>
                <span>biggest recorded day</span>
              </div>
            </div>
            <ActivityHeatmap report={report} />
          </section>
        )}
        <section className={styles.reportSection}>
          <h2>Time well spent.</h2>
          <ActivityMix report={report} />
        </section>
        <section className={styles.reportSection}>
          <h2>Your rhythm, month by month.</h2>
          <MonthBars
            values={report.months.map((m) => m.hours)}
            label="Recorded workout time (hours)"
          />
          <div className={styles.sectionStats}>
            <div>
              <strong>{report.totals.activeDays}</strong>
              <span>days with a workout</span>
            </div>
            <div>
              <strong>
                {number(
                  m.exerciseMinutes === null ? null : m.exerciseMinutes / 60,
                )}
              </strong>
              <span>recorded exercise hours</span>
            </div>
          </div>
        </section>
        {m.sleepDays > 0 && (
          <section className={styles.reportSection}>
            <h2>The quieter part of the year.</h2>
            <SleepSummary report={report} />
          </section>
        )}
        {m.heartDays > 0 && (
          <section className={styles.reportSection}>
            <h2>A different kind of rhythm.</h2>
            <HeartSummary report={report} />
          </section>
        )}
        {m.stepDays > 0 && (
          <section className={styles.reportSection}>
            <h2>One month at a time.</h2>
            <MonthBars
              values={monthlyHealth(report, "steps")}
              label="Mean steps per recorded day"
              color="#74c9ff"
            />
          </section>
        )}
        {m.activeKcal !== null && (
          <section className={styles.reportSection}>
            <h2>All the other movement counts, too.</h2>
            <div className={styles.sectionStats}>
              <div>
                <strong>{number(m.activeKcal)}</strong>
                <span>recorded active kcal</span>
              </div>
              <div>
                <strong>{hours(m.exerciseMinutes)}</strong>
                <span>recorded exercise time</span>
              </div>
            </div>
            <MonthBars
              values={monthlyHealth(report, "activeKcal")}
              label="Mean recorded active energy per day (kcal)"
              color="#f5c985"
            />
          </section>
        )}
      </div>
    </>
  );
}
