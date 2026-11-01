import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSleepReport,
  sleepPeriod,
  sleepTime,
  sleepNight,
} from "../src/lib/sleep-report";
import recorded from "../src/lib/sleep-recorded.json";
test("sleep windows preserve missing nights and use only available days", () => {
  const report = parseSleepReport(
    JSON.stringify({
      milestones: [
        {
          label: "private child name",
          availableThrough: 2,
          days: [
            { offset: -1, minutes: 480, awake: 0, rem: null, deep: null },
            { offset: 0, minutes: 360, awake: 30, rem: 20, deep: 10 },
            { offset: 1, minutes: null, awake: null, rem: null, deep: null },
            { offset: 2, minutes: 300, awake: null, rem: null, deep: null },
          ],
        },
      ],
    }),
  );
  assert.equal(report.milestones[0].label, "Before & after");
  const summary = sleepPeriod(report.milestones[0], 0, 30);
  assert.equal(summary.available, 3);
  assert.equal(summary.count, 2);
  assert.equal(summary.median, 330);
  assert.equal(summary.short, 50);
  assert.equal(summary.awakeCount, 1);
  assert.equal(summary.awake, 30);
  assert.equal(sleepTime(479.8), "8h 00m");
});
test("relative sleep fixture carries no exact dates or identity and rejects duplicate offsets", () => {
  const report = parseSleepReport(JSON.stringify(recorded));
  assert.equal(report.milestones.length, 1);
  assert.equal(sleepPeriod(report.milestones[0], -90, 0).count, 90);

  assert.ok(
    !/\d{4}-\d{2}-\d{2}|uuid|Sean|sources/i.test(JSON.stringify(report)),
  );
  report.milestones[0].days.push(report.milestones[0].days[0]);
  assert.throws(() => parseSleepReport(JSON.stringify(report)));
});

test("recorded awakenings merge adjacent awake segments without converting gaps into episodes", () => {
  const day = {
    offset: 0,
    minutes: 60,
    awake: 9,
    rem: 10,
    deep: 10,
    segments: [
      { start: 0, end: 2, stage: "awake" as const },
      { start: 2, end: 22, stage: "core" as const },
      { start: 22, end: 23, stage: "awake" as const },
      { start: 23, end: 25, stage: "awake" as const },
      { start: 25, end: 35, stage: "rem" as const },
      { start: 35, end: 40, stage: "unknown" as const },
      { start: 40, end: 50, stage: "deep" as const },
      { start: 50, end: 70, stage: "core" as const },
      { start: 70, end: 74, stage: "awake" as const },
    ],
  };
  const stats = sleepNight(day, 1);
  assert.equal(stats.episodes, 1);
  assert.equal(stats.awakeMinutes, 3);
  assert.equal(stats.longestWake, 3);
  assert.equal(stats.longestSleep, 30);
  assert.equal(sleepNight(day, 5).episodes, 0);
  assert.equal(sleepNight({ ...day, segments: undefined }).episodes, null);
});
test("staged fixture reconciles sleep totals and exposes only one de-identified timeline", () => {
  const report = parseSleepReport(JSON.stringify(recorded));
  assert.equal(report.milestones.length, 1);
  for (const day of report.milestones[0].days) {
    if (day.minutes === null) continue;
    const total = (day.segments ?? [])
      .filter((s) => ["core", "deep", "rem", "unspecified"].includes(s.stage))
      .reduce((sum, s) => sum + s.end - s.start, 0);
    assert.ok(Math.abs(total - day.minutes) < 0.15);
  }
  const before = sleepPeriod(report.milestones[0], -14, 0, 1),
    after = sleepPeriod(report.milestones[0], 0, 14, 1);
  assert.equal(before.episodes, 5);
  assert.equal(after.episodes, 5);
  assert.equal(before.awakeDuringSleep, 16.25);
  assert.equal(after.awakeDuringSleep, 27.5);
});
