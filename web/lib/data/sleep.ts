import { scoped } from "../db";
import { reportingTimeZone } from "../reportingTimeZone";
import { sleepSessions, type SleepSample, type SleepSession, type SleepStage } from "../sleep";
import { liveRead } from "./source";

const STAGES: Record<number, SleepStage> = { 0: "inBed", 1: "unspecified", 2: "awake", 3: "core", 4: "deep", 5: "rem" };
const DAY = 86400_000;

// This deliberately bounded raw read is independent of the long-range trend.
// Keep a start_ts bound for chunk pruning through accounts security barriers.
export async function getSleepSessions(userId: string): Promise<SleepSession[]> {
  return liveRead("getSleepSessions", () => demoSleep(), async () => {
    const timeZone = await reportingTimeZone(userId);
    const now = Date.now();
    const rows = await scoped(userId, (q) => q<{
      start: string; end: string; value: number; source: string;
    }>(`SELECT (extract(epoch from c.start_ts) * 1000)::bigint AS start,
               (extract(epoch from c.end_ts) * 1000)::bigint AS end,
               c.value, COALESCE(c.source_id, 0)::text AS source
          FROM category_samples c
         WHERE c.user_id = $1::uuid
           AND c.type_id = (SELECT type_id FROM sample_types WHERE identifier = $2)
           AND c.start_ts >= $3::timestamptz
           AND c.start_ts < $4::timestamptz
         ORDER BY c.start_ts, c.end_ts`,
    [userId, "HKCategoryTypeIdentifierSleepAnalysis", new Date(now - 32 * DAY), new Date(now)]));
    const names = new Map([...new Set(rows.map((r) => r.source))].sort().map((id, index) => [id, `Recording ${index + 1}`]));
    const samples: SleepSample[] = rows.flatMap((r) => STAGES[r.value] ? [{
      start: Number(r.start), end: Math.min(Number(r.end), now), stage: STAGES[r.value], source: r.source, sourceName: names.get(r.source)!,
    }] : []);
    return sleepSessions(samples, timeZone).filter((s) => s.end >= now - 30 * DAY);
  });
}

function demoSleep(): SleepSession[] {
  const samples: SleepSample[] = [];
  const midnight = Math.floor(Date.now() / DAY) * DAY;
  for (let day = 0; day < 14; day++) {
    let start = midnight - day * DAY - 3600_000;
    for (let cycle = 0; cycle < 5; cycle++) {
      for (const [stage, minutes] of [["core", 48], ["deep", 17 - cycle * 2], ["rem", 17 + cycle * 3], ["awake", 3]] as const) {
        const end = start + minutes * 60_000;
        samples.push({ start, end, stage, source: "demo", sourceName: "Sample watch" });
        start = end;
      }
    }
  }
  return sleepSessions(samples.filter((s) => s.end <= Date.now()), "UTC");
}
