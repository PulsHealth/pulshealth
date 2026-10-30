"use client";

import { useState } from "react";
import { dailySleep, SLEEP_STACK_STAGES, sleepDateKey, sleepDuration, STAGE_COLOR, STAGE_LABEL, type SleepSession } from "@/lib/sleep";
import styles from "./SleepDailyChart.module.css";

export function SleepDailyChart({ sessions, timeZone, through, selected, onSelect }: {
  sessions: SleepSession[]; timeZone: string; through: number; selected: SleepSession;
  onSelect: (session: SleepSession) => void;
}) {
  const [range, setRange] = useState<7 | 30>(7);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const days = dailySleep(sessions, timeZone, through, range);
  const selectedDate = sleepDateKey(selected.end, timeZone);
  const active = days.find((d) => d.date === activeDate) ?? days.find((d) => d.date === selectedDate);
  // Two-hour ticks with enough headroom for asleep + recorded awake.
  const max = Math.max(120, Math.ceil(Math.max(...days.map((d) => d.total)) / 120) * 120);
  const label = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const describe = (day: typeof days[number]) => `${label(day.date, { month: "short", day: "numeric", year: "numeric" })}: ${!day.sessions.length ? "No records" : day.total === 0 ? "Sleep stages not recorded" : `${day.asleep > 0 ? `${sleepDuration(day.asleep)} asleep` : "Sleep duration not recorded"}, ${SLEEP_STACK_STAGES.filter((s) => day.minutes[s] > 0).map((s) => `${STAGE_LABEL[s]} ${sleepDuration(day.minutes[s])}`).join(", ")}`}`;

  return <section className={styles.section} aria-labelledby="sleep-daily-title">
    <div className={styles.header}>
      <h3 id="sleep-daily-title">Sleep stages by day</h3>
      <div className="segmented" aria-label="Sleep comparison range">
        {([7, 30] as const).map((n) => <button key={n} type="button" aria-pressed={range === n} data-active={range === n} onClick={() => { setRange(n); setActiveDate(null); }}>{n} days</button>)}
      </div>
    </div>
    <p>One bar per wake-up day, including naps. Height includes time asleep and recorded awake; in-bed coverage stays separate.</p>
    <div className={styles.legend}>{SLEEP_STACK_STAGES.map((s) => <span key={s}><i style={{ background: STAGE_COLOR[s] }} />{STAGE_LABEL[s]}</span>)}</div>
    <div className={styles.readout} aria-live="polite">{active ? describe(active) : "Select a day to see its stages and open its latest sleep session."}</div>
    <div className={styles.chart}>
      <div className={styles.scale} aria-hidden="true">{[1, 0.75, 0.5, 0.25, 0].map((p) => <span key={p} style={{ top: `${(1 - p) * 100}%` }}>{max * p / 60}h</span>)}</div>
      <div className={styles.scroll} tabIndex={range === 30 ? 0 : undefined} role="group" aria-label={`${range}-day sleep stage chart${range === 30 ? ", scroll horizontally for all days" : ""}`}>
        <div className={styles.canvas} style={{ minWidth: range === 30 ? 840 : undefined }}>
          <div className={styles.grid} aria-hidden="true">{[0, 1, 2, 3, 4].map((n) => <span key={n} />)}</div>
          <div className={styles.columns} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((day) => <button type="button" key={day.date} className={styles.column}
              aria-label={describe(day)} aria-pressed={selectedDate === day.date} title={describe(day)}
              onFocus={() => setActiveDate(day.date)} onPointerEnter={() => setActiveDate(day.date)}
              onClick={() => { setActiveDate(day.date); const latest = day.sessions.at(-1); if (latest) onSelect(latest); }}>
              <span className={styles.barArea} aria-hidden="true">
                {day.total > 0 ? <span className={styles.stack} style={{ height: `${day.total / max * 100}%` }}>
                  {SLEEP_STACK_STAGES.map((s) => day.minutes[s] > 0 && <i key={s} data-stage={s} style={{ background: STAGE_COLOR[s], height: `${day.minutes[s] / day.total * 100}%` }} />)}
                </span> : <span className={styles.missing}>{day.sessions.length ? "◇" : "—"}</span>}
              </span>
              <span className={styles.dayLabel} aria-hidden="true">{label(day.date, range === 7 ? { weekday: "short" } : { day: "numeric" })}</span>
            </button>)}
          </div>
        </div>
      </div>
    </div>
    <p className={styles.note}>{label(days[0].date, { month: "short", day: "numeric" })} – {label(days.at(-1)!.date, { month: "short", day: "numeric", year: "numeric" })}. — No records · ◇ Stages not recorded. Each session uses its longest-sleep recording. Select a bar to open that day’s latest session above.</p>
  </section>;
}
