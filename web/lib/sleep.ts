// Sleep intervals are kept separate from in-bed coverage. A source's intervals
// are normalized before counting, so duplicate/overlapping samples cannot add
// hours twice. Detailed stages take precedence over unspecified asleep records.
export const SLEEP_STAGES = ["awake", "rem", "core", "deep", "unspecified", "inBed"] as const;
export type SleepStage = typeof SLEEP_STAGES[number];
export const STAGE_LABEL: Record<SleepStage, string> = {
  awake: "Awake", rem: "REM", core: "Core", deep: "Deep", unspecified: "Unspecified", inBed: "In bed",
};
export const STAGE_COLOR: Record<SleepStage, string> = {
  awake: "#ff899b", rem: "#81d4fa", core: "#6395ff", deep: "#a08aff", unspecified: "#b1bacb", inBed: "#788599",
};
export interface SleepInterval { start: number; end: number; stage: SleepStage }
export interface SleepSample extends SleepInterval { source: string; sourceName: string }
export interface SleepSource {
  id: string; name: string; intervals: SleepInterval[];
  minutes: Record<SleepStage, number>; asleep: number;
}
export interface SleepSession { start: number; end: number; date: string; sources: SleepSource[] }
const ASLEEP: SleepStage[] = ["core", "deep", "rem", "unspecified"];
export function sleepDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  return rounded >= 60 ? `${Math.floor(rounded / 60)}h ${rounded % 60}m` : `${rounded}m`;
}

function normalize(samples: SleepSample[]): SleepInterval[] {
  const events = samples.flatMap((s) => [{ t: s.start, stage: s.stage, delta: 1 }, { t: s.end, stage: s.stage, delta: -1 }])
    .sort((a, b) => a.t - b.t);
  const active = new Map<SleepStage, number>();
  const result: SleepInterval[] = [];
  // Deterministic resolution of conflicting stage records from one source.
  const priority: SleepStage[] = ["awake", "deep", "rem", "core", "unspecified", "inBed"];
  for (let i = 0; i < events.length;) {
    const start = events[i].t;
    while (i < events.length && events[i].t === start) {
      const e = events[i++];
      active.set(e.stage, (active.get(e.stage) ?? 0) + e.delta);
    }
    const end = events[i]?.t;
    if (end == null) break;
    const stage = priority.find((s) => (active.get(s) ?? 0) > 0);
    if (!stage) continue;
    const previous = result.at(-1);
    if (previous?.stage === stage && previous.end === start) previous.end = end;
    else result.push({ start, end, stage });
  }
  return result;
}

export function sleepSessions(samples: SleepSample[], timeZone: string): SleepSession[] {
  const sorted = samples.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const groups: SleepSample[][] = [];
  let end = -Infinity;
  for (const sample of sorted) {
    if (!groups.length || sample.start - end > 3 * 3600_000) groups.push([]);
    groups.at(-1)!.push(sample);
    end = Math.max(end, sample.end);
  }
  const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return groups.map((group) => {
    const bySource = new Map<string, SleepSample[]>();
    for (const sample of group) {
      if (!bySource.has(sample.source)) bySource.set(sample.source, []);
      bySource.get(sample.source)!.push(sample);
    }
    const sources = [...bySource].map(([id, records]): SleepSource => {
      const intervals = normalize(records.filter((r) => r.stage !== "inBed"));
      const inBed = normalize(records.filter((r) => r.stage === "inBed"));
      const minutes = Object.fromEntries(SLEEP_STAGES.map((s) => [s, 0])) as Record<SleepStage, number>;
      for (const r of [...intervals, ...inBed]) minutes[r.stage] += (r.end - r.start) / 60_000;
      return { id, name: records[0].sourceName, intervals: [...intervals, ...inBed], minutes, asleep: ASLEEP.reduce((n, s) => n + minutes[s], 0) };
    }).sort((a, b) => b.asleep - a.asleep ||
      (b.asleep - b.minutes.unspecified) - (a.asleep - a.minutes.unspecified) || a.id.localeCompare(b.id));
    const start = group[0].start;
    const end = Math.max(...group.map((s) => s.end));
    return { start, end, date: date.format(end), sources };
  });
}

/** Reporting-calendar wake date; no browser-local calendar or UTC day shifting. */
export function sleepDateKey(t: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}
export const SLEEP_STACK_STAGES = ["deep", "core", "rem", "unspecified", "awake"] as const;
export interface SleepDay {
  date: string; sessions: SleepSession[]; minutes: Record<SleepStage, number>; asleep: number; total: number;
}

// Attribute whole sessions (including naps) to their wake date, then combine
// only each session's primary recording. In-bed coverage overlaps stages and
// therefore never increases the stacked bar's height. Missing dates stay empty.
export function dailySleep(sessions: SleepSession[], timeZone: string, through: number, days: number): SleepDay[] {
  const last = sleepDateKey(through, timeZone);
  const calendarEnd = Date.parse(`${last}T00:00:00Z`);
  const byDate = new Map<string, SleepDay>();
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(calendarEnd - offset * 86400_000).toISOString().slice(0, 10);
    byDate.set(date, { date, sessions: [], minutes: Object.fromEntries(SLEEP_STAGES.map((s) => [s, 0])) as Record<SleepStage, number>, asleep: 0, total: 0 });
  }
  for (const session of sessions) {
    const day = byDate.get(sleepDateKey(session.end, timeZone));
    const primary = session.sources[0];
    if (!day || !primary) continue;
    day.sessions.push(session);
    for (const stage of SLEEP_STAGES) day.minutes[stage] += primary.minutes[stage];
    day.asleep += primary.asleep;
    day.total += primary.asleep + primary.minutes.awake;
  }
  return [...byDate.values()];
}
