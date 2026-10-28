"use client";
import { useRef, useState } from "react";
import type { Report } from "@/lib/example-report";
import { WeekChart, MarathonPoster, number, hours } from "./report-visuals";
import { RacePerformance } from "./race-performance";
import { exportImage } from "./export-image";
import styles from "./examples.module.css";
export function MarathonReview({
  report,
  compact = false,
}: {
  report: Report;
  compact?: boolean;
}) {
  const [week, setWeek] = useState(() =>
      report.weeks.reduce(
        (best, w, i) => (w.km > report.weeks[best].km ? i : best),
        0,
      ),
    ),
    [unit, setUnit] = useState<"km" | "mi">("mi"),
    [status, setStatus] = useState("");
  const svg = useRef<SVGSVGElement>(null),
    factor = unit === "mi" ? 0.621371192 : 1,
    total = report.weeks.reduce((n, w) => n + w.km, 0),
    knownLongest = report.weeks.flatMap((w) =>
      w.longest === null ? [] : [w.longest],
    ),
    longest = knownLongest.length ? Math.max(...knownLongest) : null,
    chosen = report.weeks[week],
    runs = report.runs.filter((r) => r.week === week);
  if (compact) return <MarathonPoster report={report} />;
  return (
    <div className={styles.marathon}>
      <div className={styles.trainingHero}>
        <div>
          <span className={styles.micro}>The road to race day</span>
          <h2>
            16 weeks.
            <br />
            <span>to marathon day.</span>
          </h2>
        </div>
        <div className={styles.sectionStats}>
          <div>
            <strong>
              {number(total * factor)}
              <small> {unit}</small>
            </strong>
            <span>training distance</span>
          </div>
          <div>
            <strong>{report.runs.length}</strong>
            <span>training runs</span>
          </div>
          <div>
            <strong>
              {number(longest === null ? null : longest * factor, 1)}
              <small> {unit}</small>
            </strong>
            <span>longest run</span>
          </div>
          <div>
            <strong>
              {hours(report.runs.reduce((n, r) => n + r.minutes, 0))}
            </strong>
            <span>recorded training time</span>
          </div>
        </div>
      </div>
      <p className={styles.micro}>
        {report.raceExcluded
          ? "Race workout excluded from training."
          : "No race selected; any race workout remains in the training totals."}{" "}
        {report.weeks.reduce((n, w) => n + w.missing, 0) > 0 &&
          `${report.weeks.reduce((n, w) => n + w.missing, 0)} runs have no recorded distance; totals include known distances only.`}
      </p>
      <div className={styles.trainingGrid}>
        <section className={styles.reportSection}>
          <div className={styles.sectionTitle}>
            <h2>The build-up.</h2>
            <div className={styles.segment}>
              <button
                aria-pressed={unit === "km"}
                onClick={() => setUnit("km")}
              >
                km
              </button>
              <button
                aria-pressed={unit === "mi"}
                onClick={() => setUnit("mi")}
              >
                mi
              </button>
            </div>
          </div>
          <WeekChart
            report={{
              ...report,
              weeks: report.weeks.map((w) => ({
                ...w,
                km: w.km * factor,
                longest: w.longest === null ? null : w.longest * factor,
              })),
            }}
            selected={week}
            onSelect={setWeek}
            unit={unit}
          />
          <div className={styles.legend}>
            <span>
              <i style={{ background: "#74c9ff" }} />
              Weekly distance
            </span>
            <span>
              <i style={{ background: "#f5c985" }} />
              Longest run
            </span>
            <span>× No runs recorded</span>
          </div>
          <label className={styles.weekSlider}>
            Explore a week<strong>Week {week + 1}</strong>
            <input
              aria-label="Training week"
              type="range"
              min="0"
              max="15"
              value={week}
              onChange={(e) => setWeek(Number(e.target.value))}
            />
          </label>
        </section>
        <aside className={styles.weekDetail}>
          <h2>Week {week + 1}</h2>
          <div className={styles.sectionStats}>
            <div>
              <strong>{number(chosen.km * factor, 1)}</strong>
              <span>recorded {unit}</span>
            </div>
            <div>
              <strong>{chosen.count}</strong>
              <span>runs</span>
            </div>
          </div>
          <div className={styles.dayStrip}>
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => {
              const day = runs.filter((r) => r.weekday === i);
              return (
                <div key={i}>
                  <span>{d}</span>
                  <i
                    style={{
                      background: day.length ? "#74c9ff" : "#2a3c50",
                      height: day.length
                        ? `${Math.min(70, 15 + day.reduce((n, r) => n + (r.km ?? 0), 0) * 3)}px`
                        : "8px",
                    }}
                  />
                </div>
              );
            })}
          </div>
          {runs.length ? (
            <ul className={styles.runList}>
              {runs.map((r, i) => (
                <li key={i}>
                  <span>
                    {
                      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][
                        r.weekday
                      ]
                    }
                  </span>
                  <strong>
                    {number(r.km === null ? null : r.km * factor, 1)} {unit}
                  </strong>
                  <span>{hours(r.minutes)}</span>
                  <span>
                    {r.km && r.km > 0
                      ? `${number(r.minutes / (r.km * factor), 1)} min/${unit}`
                      : "distance missing"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.shortNote}>
              No running workouts recorded this week.
            </p>
          )}
        </aside>
      </div>
      <section className={styles.reportSection}>
        <h2>All the days that made it.</h2>
        <div className={styles.trainingCalendar}>
          <div className={styles.calendarLabels}>
            <span />{" "}
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          {report.weeks.map((w, i) => (
            <button
              key={i}
              className={styles.calendarWeek}
              aria-label={`Week ${i + 1}, ${w.count} runs, ${number(w.km * factor, 1)} ${unit}`}
              aria-pressed={week === i}
              onClick={() => setWeek(i)}
            >
              <span>{i + 1}</span>
              {Array.from({ length: 7 }, (_, d) => {
                const runs = report.runs.filter(
                    (r) => r.week === i && r.weekday === d,
                  ),
                  km = runs.reduce((n, r) => n + (r.km ?? 0), 0);
                return (
                  <i
                    key={d}
                    style={{
                      background: runs.length ? "#74c9ff" : "#26384b",
                      opacity: runs.length
                        ? 0.3 + Math.min(km / 25, 1) * 0.7
                        : 0.5,
                    }}
                  />
                );
              })}
            </button>
          ))}
        </div>
      </section>
      {report.race && (
        <RacePerformance race={report.race} longest={longest} unit={unit} />
      )}
      <div className={styles.raceFooter}>
        <button
          className={styles.primaryButton}
          onClick={async () => {
            try {
              if (svg.current)
                setStatus(await exportImage(svg.current, "marathon-training"));
            } catch {
              setStatus("Could not export training poster.");
            }
          }}
        >
          Save training poster
        </button>
        <button onClick={async () => { try { if (svg.current) setStatus(await exportImage(svg.current, "marathon-training", true)); } catch { setStatus("Could not share training poster."); } }}>Share poster</button>
        <p role="status" className={styles.status}>
          {status}
        </p>
      </div>
      <div className={styles.exportOnly} aria-hidden="true">
        <MarathonPoster ref={svg} report={report} unit={unit} />
      </div>
    </div>
  );
}
