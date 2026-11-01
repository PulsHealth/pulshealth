import { test } from "node:test";
import assert from "node:assert/strict";
import { sleepOverview } from "../src/lib/sleep-overview";
import { parseSleepReport } from "../src/lib/sleep-report";
import recorded from "../src/lib/sleep-recorded.json";
test("aggregate sleep views conserve stage shares and night percentages across windows", () => {
  const milestone = parseSleepReport(JSON.stringify(recorded)).milestones[0];
  for (const window of [7, 14, 30, 90]) {
    const overview = sleepOverview(milestone, window);
    assert.equal(overview.series[0].summary.count, window);
    assert.ok(overview.series[1].summary.count <= window);
    for (const series of overview.series) {
      for (const shares of [
        series.awake,
        series.episodes,
        Object.values(series.stages),
      ])
        assert.ok(
          Math.abs(shares.reduce<number>((sum, v) => sum + (v ?? 0), 0) - 100) <
            1e-8,
        );
      assert.ok(
        series.density.every((p) => Number.isFinite(p.value) && p.value >= 0),
      );
    }
    assert.equal(
      overview.progression.length,
      window === 90 ? 5 : window === 30 ? 3 : 2,
    );
  }
});
test("missing sleep and stage records remain unknown rather than zero interruptions", () => {
  const milestone = parseSleepReport(
    JSON.stringify({
      milestones: [
        {
          availableThrough: 1,
          days: [
            { offset: -1, minutes: 480, awake: null, rem: null, deep: null },
            { offset: 0, minutes: null, awake: null, rem: null, deep: null },
          ],
        },
      ],
    }),
  ).milestones[0];
  const overview = sleepOverview(milestone, 7);
  assert.ok(overview.series[0].episodes.every((v) => v === null));
  assert.ok(Object.values(overview.series[0].stages).every((v) => v === null));
  assert.equal(overview.series[1].summary.median, null);
  assert.ok(overview.series[1].density.every((p) => p.value === 0));
});
