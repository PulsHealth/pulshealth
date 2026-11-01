"use client";

import { useState } from "react";
import { SleepClockChart } from "./SleepClockChart";
import { SLEEP_STAGES, STAGE_COLOR, STAGE_LABEL, sleepDuration, type SleepSession } from "@/lib/sleep";
import { sleepRangeDates, timelineDays } from "@/lib/sleepTimeline";
import type { RangeKey } from "@/lib/types";
import styles from "./SleepChart.module.css";

export function SleepChart({ sessions, timeZone, through, range }: { sessions: SleepSession[]; timeZone: string; through: number; range: RangeKey }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [intervalIndex, setIntervalIndex] = useState<number | null>(null);
  const dates = sleepRangeDates(range, through, timeZone, sessions[0]?.end);
  const days = timelineDays(sessions, dates.first, dates.last, timeZone);
  const day = days.find((d) => d.date === (selectedDate ?? (range === "D" ? dates.last : null)));
  const session = day?.sessions.find((s) => s.start === sessionStart) ?? day?.sessions.at(-1);
  const source = session?.sources.find((s) => s.id === sourceId) ?? session?.sources[0];
  const recordedDays = days.filter((d) => d.sessions.some((s) => s.sources[0].asleep > 0));
  const totals = Object.fromEntries(SLEEP_STAGES.map((stage) => [stage, days.reduce((n, d) => n + d.sessions.reduce((n, s) => n + s.sources[0].minutes[stage], 0), 0)])) as Record<typeof SLEEP_STAGES[number], number>;
  const totalAsleep = recordedDays.reduce((n, d) => n + d.sessions.reduce((n, s) => n + s.sources[0].asleep, 0), 0);
  const asleep = day ? source?.asleep ?? 0 : (recordedDays.length ? totalAsleep / recordedDays.length : 0);
  const formatDate = (date: string) => new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(Date.parse(date + "T12:00:00Z"));
  const time = (t: number) => new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(t);
  const intervals = source?.intervals.filter((i) => i.stage !== "inBed" || !source.intervals.some((s) => s.stage !== "inBed")).sort((a, b) => a.start - b.start) ?? [];
  const stages = SLEEP_STAGES.filter((s) => ["awake", "rem", "core", "deep"].includes(s) || intervals.some((i) => i.stage === s));
  const start = intervals[0]?.start ?? 0, end = intervals.at(-1)?.end ?? 1;
  const x = (t: number) => (t - start) / Math.max(1, end - start) * 1000;
  const active = intervalIndex == null ? null : intervals[intervalIndex];
  const selectDay = (date: string) => { setSelectedDate(date); setSessionStart(null); setSourceId(""); setIntervalIndex(null); };
  return <section className={`panel ${styles.panel}`} aria-label="Sleep history">
    {selectedDate && range !== "D" && <button type="button" className={styles.back} onClick={() => { setSelectedDate(null); setIntervalIndex(null); }}>‹ All nights</button>}
    <div className={styles.headline}>
      <span>{day ? "Time asleep" : "Average time asleep"}</span>
      <strong>{asleep > 0 ? sleepDuration(asleep) : "—"}</strong>
      <p>{day ? formatDate(day.date) : `${formatDate(dates.first)} – ${formatDate(dates.last)}`}</p>
    </div>
    {!sessions.length || (day && !session) ? <p className={styles.empty}>No sleep records for {day ? "this day" : "this range"}. Choose another range or sync Sleep Stages from your iPhone.</p>
    : day && source ? <>
      <div className={styles.controls}>
        {day.sessions.length > 1 && <label>Sleep session<select value={session!.start} onChange={(e) => { setSessionStart(Number(e.target.value)); setSourceId(""); setIntervalIndex(null); }}>{day.sessions.map((s) => <option key={s.start} value={s.start}>{time(s.start)} – {time(s.end)}</option>)}</select></label>}
        {session!.sources.length > 1 && <label>Recording<select value={source.id} onChange={(e) => { setSourceId(e.target.value); setIntervalIndex(null); }}>{session!.sources.map((s) => <option key={s.id} value={s.id}>{s.name} · {sleepDuration(s.asleep)}</option>)}</select></label>}
      </div>
      <div className={styles.readout} aria-live="polite">{active ? `${STAGE_LABEL[active.stage]} · ${time(active.start)} – ${time(active.end)} · ${sleepDuration((active.end - active.start) / 60000)}` : `${time(start)} – ${time(end)}`}</div>
      <div className={styles.night} role="group" tabIndex={0} aria-label="Connected sleep stage timeline. Arrow keys explore intervals; Escape clears selection."
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key)) return;
          e.preventDefault();
          if (e.key === "Escape") setIntervalIndex(null);
          else setIntervalIndex(e.key === "Home" ? 0 : e.key === "End" ? intervals.length - 1 : Math.max(0, Math.min(intervals.length - 1, (intervalIndex ?? (e.key === "ArrowRight" ? -1 : intervals.length)) + (e.key === "ArrowRight" ? 1 : -1))));
        }}>
        <div className={styles.stageLabels}>{stages.map((s) => <span key={s}>{STAGE_LABEL[s]}</span>)}</div>
        <div className={styles.nightPlot}>
          <svg viewBox={`0 0 1000 ${stages.length * 48}`} preserveAspectRatio="none" style={{ height: stages.length * 48 }} aria-hidden="true">
            {stages.map((s, row) => <line key={s} x1="0" x2="1000" y1={row * 48 + 24} y2={row * 48 + 24} stroke="var(--border)" />)}
            {intervals.slice(1).map((s, i) => intervals[i].end === s.start ? <line key={`join-${s.start}`} x1={x(s.start)} x2={x(s.start)} y1={stages.indexOf(intervals[i].stage) * 48 + 24} y2={stages.indexOf(s.stage) * 48 + 24} stroke={STAGE_COLOR[s.stage]} strokeOpacity="0.3" strokeWidth="8" /> : null)}
            {intervals.map((s, i) => <rect key={`${s.start}-${s.stage}`} data-stage={s.stage} x={x(s.start)} width={Math.max(1, x(s.end) - x(s.start))} y={stages.indexOf(s.stage) * 48 + 9} height="30" rx="6" fill={STAGE_COLOR[s.stage]} stroke={intervalIndex === i ? "var(--fg)" : "none"} strokeWidth="2" onPointerEnter={() => setIntervalIndex(i)} onClick={() => setIntervalIndex(i)} />)}
          </svg>
          <div className={styles.nightAxis}>{[0, .5, 1].map((p) => <span key={p}>{time(start + p * (end - start))}</span>)}</div>
        </div>
      </div>
    </> : <SleepClockChart days={days} timeZone={timeZone} onSelect={selectDay} />}

    <div className={styles.breakdown}>{(["awake", "rem", "core", "deep", "unspecified"] as const).map((s) => {
      const value = source ? source.minutes[s] : totals[s];
      return <div key={s}><span><i style={{ background: STAGE_COLOR[s] }} />{STAGE_LABEL[s]}</span><strong>{value > 0 ? sleepDuration(value) : "—"}</strong><small>{day ? "Recorded time" : "Total in range"}</small></div>;
    })}</div>
    <p className={styles.note}>{timeZone} · {day ? "Gaps indicate no recorded stage." : `${recordedDays.length} days with sleep records. Select a night for details.`}{(source?.minutes.inBed ?? totals.inBed) > 0 ? ` Time in bed: ${sleepDuration(source?.minutes.inBed ?? totals.inBed)} (separate from sleep stages).` : ""}</p>
    {source && <details className={styles.details}><summary>Recorded intervals</summary><div className={styles.tableWrap}><table><thead><tr><th>Stage</th><th>Start</th><th>End</th><th>Duration</th></tr></thead><tbody>{source.intervals.map((s) => <tr key={`${s.start}-${s.stage}`}><td>{STAGE_LABEL[s.stage]}</td><td>{time(s.start)}</td><td>{time(s.end)}</td><td>{sleepDuration((s.end - s.start) / 60000)}</td></tr>)}</tbody></table></div></details>}
  </section>;
}
