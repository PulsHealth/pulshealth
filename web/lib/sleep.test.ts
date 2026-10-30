import { describe, expect, it } from "vitest";
import { sleepSessions, type SleepSample, type SleepStage } from "./sleep";
const base = Date.parse("2026-10-01T23:00:00Z");
const sample = (start: number, end: number, stage: SleepStage, source = "1"): SleepSample => ({ start: base + start * 60_000, end: base + end * 60_000, stage, source, sourceName: source });

describe("sleep sessions", () => {
  it("unions duplicates, prefers detailed intervals and keeps in-bed separate", () => {
    const [night] = sleepSessions([
      sample(0, 480, "inBed"), sample(0, 450, "unspecified"),
      sample(0, 180, "core"), sample(0, 180, "core"),
      sample(180, 240, "deep"), sample(240, 300, "rem"), sample(300, 310, "awake"),
    ], "UTC");
    expect(night.sources[0].minutes).toEqual({ core: 180, deep: 60, rem: 60, awake: 10, unspecified: 140, inBed: 480 });
    expect(night.sources[0].asleep).toBe(440);
  });
  it("keeps sources distinct and breaks equal-duration ties in favor of stages", () => {
    const [night] = sleepSessions([sample(0, 400, "unspecified", "1"), sample(0, 200, "core", "2"), sample(200, 400, "rem", "2")], "UTC");
    expect(night.sources).toHaveLength(2);
    expect(night.sources[0].id).toBe("2");
    expect(night.sources[0].asleep).toBe(400);
  });
  it("splits naps, sorts input, and labels the wake date in the reporting zone", () => {
    const nights = sleepSessions([sample(1000, 1060, "unspecified"), sample(0, 480, "core")], "America/Los_Angeles");
    expect(nights).toHaveLength(2);
    expect(nights[0].date).toBe("2026-10-02");
    expect(sleepSessions([sample(0, 60, "core")], "America/Los_Angeles")[0].date).toBe("2026-10-01");
  });
  it("uses elapsed time over the daylight-saving transition", () => {
    const start = Date.parse("2026-11-01T01:30:00-07:00");
    const end = Date.parse("2026-11-01T01:30:00-08:00");
    const [night] = sleepSessions([{ start, end, stage: "core", source: "1", sourceName: "Watch" }], "America/Los_Angeles");
    expect(night.sources[0].asleep).toBe(60);
    expect(night.date).toBe("2026-11-01");
  });
  it("does not fabricate stages for old devices or in-bed-only records", () => {
    const [night] = sleepSessions([sample(0, 480, "inBed"), sample(30, 450, "unspecified")], "UTC");
    expect(night.sources[0].minutes.core).toBe(0);
    expect(night.sources[0].asleep).toBe(420);
    expect(sleepSessions([sample(0, 60, "inBed")], "UTC")[0].sources[0].asleep).toBe(0);
  });
  it("drops invalid and non-positive intervals; gaps remain unfilled", () => {
    const [night] = sleepSessions([sample(0, 60, "core"), sample(90, 120, "rem"), sample(5, 4, "deep"), sample(NaN, 10, "awake")], "UTC");
    expect(night.sources[0].asleep).toBe(90);
    expect(night.sources[0].intervals).toHaveLength(2);
  });
});
