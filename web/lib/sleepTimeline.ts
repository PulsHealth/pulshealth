import { RANGES } from "./metrics";
import { sleepDateKey, type SleepInterval, type SleepSession } from "./sleep";
import type { RangeKey } from "./types";
const DAY = 86400_000;

export function sleepRangeDates(range: RangeKey, through: number, zone: string, earliest?: number | null) {
  const last = sleepDateKey(through, zone);
  const count = Math.ceil((RANGES[range].spanMs ?? DAY) / DAY);
  const first = range === "ALL" && earliest != null ? sleepDateKey(earliest, zone)
    : new Date(Date.parse(last) - (count - 1) * DAY).toISOString().slice(0, 10);
  return { first, last };
}

export interface SleepTimelineDay { date: string; sessions: SleepSession[] }
export function timelineDays(sessions: SleepSession[], first: string, last: string, zone: string): SleepTimelineDay[] {
  const byDate = new Map<string, SleepSession[]>();
  for (const s of sessions) {
    const date = sleepDateKey(s.end, zone);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(s);
  }
  const days: SleepTimelineDay[] = [];
  for (let t = Date.parse(first); t <= Date.parse(last); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.push({ date, sessions: (byDate.get(date) ?? []).sort((a, b) => a.start - b.start) });
  }
  return days;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function wallMilliseconds(t: number, zone: string): number {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }));
  const p = Object.fromEntries(formatters.get(zone)!.formatToParts(t).map((p) => [p.type, p.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) + ((t % 1000) + 1000) % 1000;
}
export interface ClockInterval extends SleepInterval { top: number; bottom: number }
/** Clock coordinates relative to midnight on the wake date; negative = prior evening.
 * Split at UTC-offset transitions, retaining both occurrences of a repeated hour.
 * Gaps and missing spring-forward clock minutes never get filled with a stage. */
export function clockIntervals(interval: SleepInterval, wakeDate: string, zone: string): ClockInterval[] {
  const result: ClockInterval[] = [];
  const origin = Date.parse(wakeDate);
  let start = interval.start;
  while (start < interval.end) {
    const offset = wallMilliseconds(start, zone) - start;
    let end = Math.min(interval.end, start + 6 * 3600_000);
    if (wallMilliseconds(end - 1, zone) - (end - 1) !== offset) {
      let low = start + 1, high = end;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (wallMilliseconds(mid, zone) - mid === offset) low = mid + 1;
        else high = mid;
      }
      end = low;
    }
    result.push({ ...interval, start, end, top: (start + offset - origin) / 60_000, bottom: (end + offset - origin) / 60_000 });
    start = end;
  }
  return result;
}
export function clockLabel(minute: number): string {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  return `${hour % 12 || 12}${normalized % 60 ? `:${String(Math.round(normalized % 60)).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}

/** Separate overlapping local-clock occurrences (e.g. 01:00 before/after DST).
 * Adjacent, non-overlapping intervals keep the full column width. */
export function clockLanes(intervals: ClockInterval[]): (ClockInterval & { lane: number; lanes: number })[] {
  const sorted = intervals.slice().sort((a, b) => a.top - b.top || a.start - b.start);
  const result: (ClockInterval & { lane: number; lanes: number })[] = [];
  let group: ClockInterval[] = [], maxEnd = -Infinity;
  const flush = () => {
    const ends: number[] = [];
    const assigned = group.map((p) => {
      let lane = ends.findIndex((end) => end <= p.top);
      if (lane < 0) lane = ends.length;
      ends[lane] = p.bottom;
      return { ...p, lane, lanes: 1 };
    });
    result.push(...assigned.map((p) => ({ ...p, lanes: ends.length })));
    group = [];
  };
  for (const p of sorted) {
    if (p.top >= maxEnd && group.length) { flush(); maxEnd = -Infinity; }
    group.push(p); maxEnd = Math.max(maxEnd, p.bottom);
  }
  flush();
  return result;
}
