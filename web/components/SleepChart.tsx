"use client";

import { useState } from "react";
import { SLEEP_STAGES, STAGE_COLOR, STAGE_LABEL, sleepDuration, type SleepSession } from "@/lib/sleep";
import styles from "./SleepChart.module.css";

export function SleepChart({ sessions, timeZone }: { sessions: SleepSession[]; timeZone: string }) {
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const foundIndex = sessions.findIndex((s) => s.start === sessionStart);
  const sessionIndex = foundIndex < 0 ? sessions.length - 1 : foundIndex;
  const [sourceId, setSourceId] = useState("");
  const [intervalIndex, setIntervalIndex] = useState<number | null>(null);
  const session = sessions[sessionIndex];
  const date = (t: number) => new Intl.DateTimeFormat("en", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(t);
  const time = (t: number) => new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(t);
  const choose = (index: number) => { setSessionStart(sessions[index].start); setSourceId(""); setIntervalIndex(null); };
  if (!session) return <section className={`panel ${styles.panel}`}><h2>Sleep stages</h2><p>No sleep sessions in the last 30 days. Sync Sleep Stages from your iPhone to see your timeline here.</p></section>;
  const source = session.sources.find((s) => s.id === sourceId) ?? session.sources[0];
  const intervals = [...source.intervals].sort((a, b) => a.start - b.start);
  const active = intervalIndex == null ? null : intervals[intervalIndex];
  const start = Math.min(...intervals.map((s) => s.start));
  const end = Math.max(...intervals.map((s) => s.end));
  const x = (t: number) => ((t - start) / Math.max(1, end - start)) * 100;
  const maxMinutes = Math.max(60, ...sessions.map((s) => s.sources[0].asleep));
  const hasStages = source.minutes.core + source.minutes.deep + source.minutes.rem > 0;

  return <section className={`panel ${styles.panel}`} aria-labelledby="sleep-title">
    <div className={styles.header}>
      <div><h2 id="sleep-title">Your night, stage by stage</h2><p>Sleep sessions ending in the last 30 days. Times in {timeZone}.</p></div>
      <label className={styles.field}>Sleep session
        <select value={sessionIndex} onChange={(e) => choose(Number(e.target.value))}>
          {sessions.map((s, i) => <option key={s.start} value={i}>{date(s.end)} · {time(s.start)}</option>).reverse()}
        </select>
      </label>
    </div>
    <div className={styles.summary}>
      <div><span>Time asleep</span><strong>{source.asleep > 0 ? sleepDuration(source.asleep) : "—"}</strong></div>
      <div><span>Recorded awake</span><strong>{source.minutes.awake ? sleepDuration(source.minutes.awake) : "—"}</strong></div>
      <div><span>Session window</span><strong className={styles.window}>{time(start)} – {time(end)}</strong></div>
    </div>
    {session.sources.length > 1 && <label className={styles.field}>Recording source
      <select value={source.id} onChange={(e) => { setSourceId(e.target.value); setIntervalIndex(null); }}>
        {session.sources.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.asleep > 0 ? `${sleepDuration(s.asleep)} asleep` : "Sleep duration not recorded"}</option>)}
      </select>
    </label>}
    <p className={styles.note}>One recording source at a time; the longest recorded sleep is selected by default. In-bed time is separate from time asleep. Gaps have no recorded stage.</p>
    {!hasStages && <p className={styles.notice}>This source has no Core, Deep or REM detail. Unspecified sleep remains visible; choose another source if available.</p>}
    <div className={styles.readout} aria-live="polite">
      {active ? `${STAGE_LABEL[active.stage]} · ${time(active.start)} – ${time(active.end)} · ${sleepDuration((active.end - active.start) / 60_000)}` : "Hover or tap an interval for details. Focus the chart and use the arrow keys to explore."}
    </div>
    <div className={styles.timeline} role="group" tabIndex={0}
      aria-label="Sleep stage timeline. Left and right arrows select intervals; Home and End select the first and last. Escape clears selection."
      onKeyDown={(e) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End", "Escape"].includes(e.key)) return;
        e.preventDefault();
        if (e.key === "Escape") setIntervalIndex(null);
        else setIntervalIndex(e.key === "Home" ? 0 : e.key === "End" ? intervals.length - 1 : Math.max(0, Math.min(intervals.length - 1, (intervalIndex ?? (e.key === "ArrowRight" ? -1 : intervals.length)) + (e.key === "ArrowRight" ? 1 : -1))));
      }}>
      {SLEEP_STAGES.map((stage) => <div className={styles.trackRow} key={stage}>
        <span className={styles.trackLabel}>{STAGE_LABEL[stage]}</span>
        <div className={styles.track}>
          {intervals.map((s, i) => s.stage !== stage ? null : <button key={`${s.start}-${s.stage}`} type="button" tabIndex={-1}
            className={styles.interval} aria-label={`${STAGE_LABEL[s.stage]}: ${time(s.start)} – ${time(s.end)}, ${sleepDuration((s.end - s.start) / 60_000)}`}
            style={{ left: `${x(s.start)}%`, width: `${Math.max(0.2, x(s.end) - x(s.start))}%`, background: STAGE_COLOR[s.stage], outline: intervalIndex === i ? "2px solid var(--fg)" : undefined }}
            onPointerEnter={() => setIntervalIndex(i)} onClick={() => setIntervalIndex(i)}
            title={`${STAGE_LABEL[s.stage]}: ${time(s.start)} – ${time(s.end)}, ${sleepDuration((s.end - s.start) / 60_000)}`} />)}
        </div>
      </div>)}
      <div className={styles.axis}>{[0, 0.5, 1].map((fraction) => <span key={fraction}>{time(start + fraction * (end - start))}</span>)}</div>
    </div>
    <div className={styles.breakdown}>
      {SLEEP_STAGES.map((stage) => <div key={stage}>
        <span><i style={{ background: STAGE_COLOR[stage] }} />{STAGE_LABEL[stage]}</span>
        <strong>{source.minutes[stage] ? sleepDuration(source.minutes[stage]) : "—"}</strong>
        <small>{!["awake", "inBed"].includes(stage) && source.asleep > 0 && source.minutes[stage] > 0 ? `${Math.round(source.minutes[stage] / source.asleep * 100)}% of sleep` : stage === "inBed" ? "Separate coverage" : "Recorded time"}</small>
      </div>)}
    </div>
    <h3 className={styles.compareTitle}>Compare recent sessions</h3>
    <p>Each bar shows time asleep, split by stage. Select a session to explore it above.</p>
    <div className={styles.comparisons}>
      {sessions.map((s, i) => {
        const primary = s.sources[0];
        return <button key={s.start} className={styles.comparison} aria-pressed={sessionIndex === i} onClick={() => choose(i)}
          aria-label={`${date(s.end)}, ${time(s.start)}: ${primary.asleep > 0 ? `${sleepDuration(primary.asleep)} asleep` : "Sleep duration not recorded"}. ${["rem", "core", "deep", "unspecified"].map((stage) => `${STAGE_LABEL[stage as keyof typeof STAGE_LABEL]} ${(primary.minutes[stage as keyof typeof primary.minutes] > 0 ? sleepDuration(primary.minutes[stage as keyof typeof primary.minutes]) : "not recorded")}`).join(", ")}`}>
          <span>{new Intl.DateTimeFormat("en", { timeZone, month: "short", day: "numeric" }).format(s.end)}</span>
          <span className={styles.bar} aria-hidden="true">{(["rem", "core", "deep", "unspecified"] as const).map((stage) => <i key={stage} style={{ background: STAGE_COLOR[stage], width: `${primary.minutes[stage] / maxMinutes * 100}%` }} />)}</span>
          <span>{primary.asleep > 0 ? sleepDuration(primary.asleep) : "—"}</span>
        </button>;
      }).reverse()}
    </div>
    <details className={styles.details}><summary>Recorded intervals</summary>
      <div className={styles.tableWrap}><table><thead><tr><th>Stage</th><th>Start</th><th>End</th><th>Duration</th></tr></thead>
        <tbody>{intervals.map((s) => <tr key={`${s.start}-${s.stage}`}><td>{STAGE_LABEL[s.stage]}</td><td>{date(s.start)} {time(s.start)}</td><td>{date(s.end)} {time(s.end)}</td><td>{sleepDuration((s.end - s.start) / 60_000)}</td></tr>)}</tbody>
      </table></div>
    </details>
  </section>;
}
