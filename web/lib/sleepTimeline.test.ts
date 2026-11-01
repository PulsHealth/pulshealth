import { describe, expect, it } from "vitest";
import { clockIntervals, clockLabel, clockLanes, sleepRangeDates, timelineDays } from "./sleepTimeline";
import { sleepSessions } from "./sleep";
import { RANGE_ORDER } from "./metrics";
const now = Date.parse("2026-10-31T03:00:00Z"); // Oct 30 in California

describe("sleep clock timeline", () => {
  it("uses each shared metric range and reporting-calendar dates", () => {
    const counts = [1, 7, 30, 90, 182, 365, 730, 1825];
    RANGE_ORDER.slice(0, -1).forEach((range, i) => {
      const { first, last } = sleepRangeDates(range, now, "America/Los_Angeles");
      expect(last).toBe("2026-10-30");
      expect(timelineDays([], first, last, "America/Los_Angeles")).toHaveLength(counts[i]);
    });
    expect(sleepRangeDates("ALL", now, "UTC", Date.parse("2020-01-01"))).toEqual({ first: "2020-01-01", last: "2026-10-31" });
  });
  it("positions stages at recorded clock times rather than cumulative durations", () => {
    const interval = { start: Date.parse("2026-10-29T23:00:00-07:00"), end: Date.parse("2026-10-30T01:00:00-07:00"), stage: "core" as const };
    const pieces = clockIntervals(interval, "2026-10-30", "America/Los_Angeles");
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ top: -60, bottom: 60 });
    const afterGap = clockIntervals({ ...interval, start: Date.parse("2026-10-30T02:00:00-07:00"), end: Date.parse("2026-10-30T03:00:00-07:00"), stage: "rem" }, "2026-10-30", "America/Los_Angeles");
    expect(afterGap[0]).toMatchObject({ top: 120, bottom: 180 });
  });
  it("keeps both repeated DST hours and leaves spring-forward clock gaps empty", () => {
    const fallback = clockIntervals({ start: Date.parse("2026-11-01T01:30:00-07:00"), end: Date.parse("2026-11-01T01:30:00-08:00"), stage: "core" }, "2026-11-01", "America/Los_Angeles");
    expect(fallback.map((p) => [p.top, p.bottom])).toEqual([[90, 120], [60, 90]]);
    expect(fallback.reduce((n, p) => n + (p.end - p.start), 0)).toBe(3600000);
    const spring = clockIntervals({ start: Date.parse("2026-03-08T01:30:00-08:00"), end: Date.parse("2026-03-08T03:30:00-07:00"), stage: "deep" }, "2026-03-08", "America/Los_Angeles");
    expect(spring.map((p) => [p.top, p.bottom])).toEqual([[90, 120], [180, 210]]);
  });
  it("renders different stages in repeated clock hours side by side", () => {
    const a = clockIntervals({ start: Date.parse("2026-11-01T01:00:00-07:00"), end: Date.parse("2026-11-01T01:30:00-07:00"), stage: "core" }, "2026-11-01", "America/Los_Angeles");
    const b = clockIntervals({ start: Date.parse("2026-11-01T01:00:00-08:00"), end: Date.parse("2026-11-01T01:30:00-08:00"), stage: "rem" }, "2026-11-01", "America/Los_Angeles");
    const lanes = clockLanes([...a, ...b]);
    expect(lanes.map((p) => [p.stage, p.lane, p.lanes])).toEqual([["core", 0, 2], ["rem", 1, 2]]);
  });
  it("retains blank dates and groups nights/naps under their reporting wake date", () => {
    const sessions = sleepSessions([{ start: now - 3 * 3600000, end: now - 2 * 3600000, source: "1", sourceName: "Watch", stage: "core" }], "UTC");
    const days = timelineDays(sessions, "2026-10-29", "2026-10-31", "America/Los_Angeles");
    expect(days.map((d) => d.sessions.length)).toEqual([0, 1, 0]);
    expect(clockLabel(-60)).toBe("11 PM");
    expect(clockLabel(0)).toBe("12 AM");
    expect(clockLabel(720)).toBe("12 PM");
  });
});
