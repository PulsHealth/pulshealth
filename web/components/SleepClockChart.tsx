"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clockIntervals, clockLabel, clockLanes, type SleepTimelineDay } from "@/lib/sleepTimeline";
import { sleepDuration, STAGE_COLOR, STAGE_LABEL, type SleepInterval } from "@/lib/sleep";
import styles from "./SleepChart.module.css";

export function SleepClockChart({ days, timeZone, onSelect }: { days: SleepTimelineDay[]; timeZone: string; onSelect: (date: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [left, setLeft] = useState(0);
  const scrollPosition = useRef(0);
  const clockFormat = useMemo(() => new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }), [timeZone]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }), []);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const column = Math.max(12, width / Math.min(days.length, 90));
  const fullWidth = column * days.length;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);

    return () => observer.disconnect();
  }, []);
  const geometry = useRef<{ viewport: number; full: number; column: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = geometry.current;
    const atEnd = !previous || scrollPosition.current + previous.viewport >= previous.full - 4;
    el.scrollLeft = atEnd ? fullWidth : scrollPosition.current / previous.column * column;
    scrollPosition.current = el.scrollLeft;
    geometry.current = { viewport: el.clientWidth, full: fullWidth, column };
  }, [fullWidth, width, column]);
  const bounds = useMemo(() => {
    let min = -180, max = 600;
    for (const day of days) for (const session of day.sessions) {
      const intervals = chartIntervals(session.sources[0]?.intervals ?? []);
      if (!intervals.length) continue;
      for (const p of clockIntervals({ start: intervals[0].start, end: intervals.at(-1)!.end, stage: "unspecified" }, day.date, timeZone)) {
        min = Math.min(min, p.top); max = Math.max(max, p.bottom);
      }
    }
    return { min: Math.floor(min / 180) * 180, max: Math.ceil(max / 180) * 180 };
  }, [days, timeZone]);
  const ticks = Array.from({ length: (bounds.max - bounds.min) / 180 + 1 }, (_, i) => bounds.min + i * 180);
  const scroll = Math.min(left, Math.max(0, fullWidth - width));
  const first = Math.max(0, Math.floor(scroll / column) - 2);
  const last = Math.min(days.length, Math.ceil((scroll + width) / column) + 2);
  const visible = useMemo(() => days.slice(first, last).map((day) => ({ ...day,
    pieces: clockLanes(day.sessions.flatMap((session) => chartIntervals(session.sources[0].intervals).flatMap((interval) => clockIntervals(interval, day.date, timeZone)))),
  })), [days, first, last, timeZone]);
  const active = days.find((d) => d.date === activeDate);
  const formatDate = (date: string) => dateFormat.format(Date.parse(date + "T12:00:00Z"));
  const describe = (day: SleepTimelineDay) => {
    const asleep = day.sessions.reduce((n, s) => n + s.sources[0].asleep, 0);
    return `${formatDate(day.date)} · ${!day.sessions.length ? "No records" : asleep > 0 ? `${sleepDuration(asleep)} asleep` : "Sleep duration not recorded"}`;
  };
  const y = (minute: number) => (minute - bounds.min) / (bounds.max - bounds.min) * 100;
  const labelsEvery = Math.max(1, Math.ceil(65 / column));
  return <>
    <div className={styles.clockReadout} aria-live="polite">{active ? describe(active) : "Select a night to see its stages"}</div>
    <div className={styles.clockChart}>
      <div className={styles.clockAxis} aria-hidden="true">{ticks.map((t) => <span key={t} style={{ top: `${y(t)}%` }}>{clockLabel(t)}</span>)}</div>
      <div ref={ref} className={styles.clockScroll} role="group" aria-label="Sleep timing by wake date. Vertical axis is local clock time. Select a date for its connected stage timeline."
        onScroll={(e) => {
          if (geometry.current && e.currentTarget.clientWidth !== geometry.current.viewport) return;
          scrollPosition.current = e.currentTarget.scrollLeft;
          setLeft(e.currentTarget.scrollLeft);
        }} tabIndex={0}
        onKeyDown={(e) => {
          if (!ref.current || !["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(e.key)) return;
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          const index = days.findIndex((d) => d.date === activeDate);
          const next = e.key === "Home" ? 0 : e.key === "End" ? days.length - 1 : Math.max(0, Math.min(days.length - 1, (index < 0 ? last - 1 : index) + (e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0)));
          const day = days[next];
          if (e.key === "Enter") { if (day.sessions.length) onSelect(day.date); return; }
          setActiveDate(day.date);
          if (next * column < ref.current.scrollLeft) ref.current.scrollLeft = next * column;
          else if ((next + 1) * column > ref.current.scrollLeft + width) ref.current.scrollLeft = (next + 1) * column - width;
        }}>
        <div className={styles.clockCanvas} style={{ width: fullWidth }}>
          <div className={styles.clockGrid} aria-hidden="true">{ticks.map((t) => <span key={t} style={{ top: `${y(t)}%` }} />)}</div>
          {visible.map((day, offset) => {
            const i = first + offset;
            return <button type="button" key={day.date} className={styles.clockColumn} style={{ left: i * column, width: column }}
              aria-label={`${describe(day)}${day.sessions.length ? ", view sleep stages" : ""}`} title={describe(day)}
              onFocus={() => setActiveDate(day.date)} onPointerEnter={() => setActiveDate(day.date)}
              onClick={() => { setActiveDate(day.date); if (day.sessions.length) onSelect(day.date); }}>
              <span className={styles.clockDayPlot} aria-hidden="true">
                {day.pieces.map((p) => <i key={`${p.start}-${p.stage}`} data-stage={p.stage} data-clock-lane={`${p.lane}/${p.lanes}`} style={{ top: `${y(p.top)}%`, height: `${(p.bottom - p.top) / (bounds.max - bounds.min) * 100}%`, left: `${18 + p.lane * 64 / p.lanes}%`, width: `${64 / p.lanes}%`, background: STAGE_COLOR[p.stage], opacity: p.stage === "inBed" ? 0.4 : 1 }}
                  title={`${STAGE_LABEL[p.stage]} · ${clockFormat.format(p.start)} · ${sleepDuration((p.end - p.start) / 60000)}`} />)}
              </span>
              {(i % labelsEvery === 0 || i === days.length - 1) && <span className={styles.clockDate} aria-hidden="true">{new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short", day: "numeric" }).format(Date.parse(day.date + "T12:00:00Z"))}</span>}
            </button>;
          })}
        </div>
      </div>
    </div>
  </>;
}
function chartIntervals(intervals: SleepInterval[]) {
  const stages = intervals.filter((i) => i.stage !== "inBed");
  return (stages.length ? stages : intervals).slice().sort((a, b) => a.start - b.start);
}
