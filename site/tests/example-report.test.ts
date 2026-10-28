import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReport,
  yearMetrics,
  monthlyHealth,
} from "../src/lib/example-report";
import { sampleData, parseExampleData } from "../src/lib/example-data";
import recorded from "../src/lib/example-recorded.json";

test("health year preserves true zeros, nulls and observed-day denominators", () => {
  const data = sampleData();
  data.daily = [
    {
      date: "2025-01-01",
      steps: 0,
      sleepMinutes: 420,
      restingHR: 60,
      hrv: null,
      activeKcal: 0,
      exerciseMinutes: 0,
    },
    {
      date: "2025-01-02",
      steps: 6000,
      sleepMinutes: null,
      restingHR: null,
      hrv: 50,
      activeKcal: 400,
      exerciseMinutes: 30,
    },
  ];
  const report = buildReport(parseExampleData(JSON.stringify(data))),
    m = yearMetrics(report);
  assert.equal(m.steps, 6000);
  assert.equal(m.avgSteps, 3000);
  assert.equal(m.stepDays, 2);
  assert.equal(m.sleepMinutes, 420);
  assert.equal(m.sleepDays, 1);
  assert.equal(m.restingHR, 60);
  assert.equal(monthlyHealth(report, "steps")[0], 3000);
  assert.equal(monthlyHealth(report, "steps")[1], null);
  assert.equal(report.days[2].steps, null);
});
test("published model removes identity, exact event dates and geographic coordinates", () => {
  const data = sampleData();
  data.workouts[0].id = "private-source-record";
  const report = buildReport(data),
    json = JSON.stringify(report);
  for (const key of [
    '"lat":',
    '"lon":',
    '"date":',
    '"raceDate":',
    '"timeZone":',
    "private-source-record",
  ])
    assert.ok(!json.includes(key), key);
  assert.equal(report.raceExcluded, true);
  delete data.raceId;
  assert.equal(buildReport(data).raceExcluded, false);
});
test("annual charts reconcile with sport totals and handle leap years", () => {
  const report = buildReport(sampleData());
  assert.ok(
    Math.abs(
      report.months.reduce((n, m) => n + m.hours, 0) - report.totals.hours,
    ) < 1e-8,
  );
  assert.equal(
    report.sports.reduce((n, s) => n + s.count, 0),
    report.totals.workouts,
  );
  const data = sampleData();
  data.year = 2024;
  assert.equal(buildReport(data).days.length, 366);
});
test("recorded report retains complete coverage and relative training consistency", () => {
  assert.equal(recorded.days.length, 365);
  assert.equal(
    recorded.runs.length,
    recorded.weeks.reduce((n, w) => n + w.count, 0),
  );
  assert.ok(
    Math.abs(
      recorded.runs.reduce((n, r) => n + (r.km ?? 0), 0) -
        recorded.weeks.reduce((n, w) => n + w.km, 0),
    ) < 1e-8,
  );
  assert.ok(recorded.days.filter((d) => d.sleepMinutes !== null).length > 0);
  assert.ok(
    !JSON.stringify(recorded).match(
      /"(?:uuid|lat|lon|raceDate|timestamp|timeZone|date)":/,
    ),
  );
});

test("race metrics retain only measured display fields and reject invalid values", () => {
  const data = sampleData();
  const race = data.workouts.find((w) => w.id === data.raceId)!;
  race.metrics = { heartRate: 154, strideM: 1.01, steps: 43342 };
  const report = buildReport(parseExampleData(JSON.stringify(data)));
  assert.deepEqual(report.race?.metrics, race.metrics);
  race.metrics.heartRate = -1;
  assert.throws(() => parseExampleData(JSON.stringify(data)), /metrics/);
});
