import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSensorReport,
  samplingStats,
  minuteCounts,
} from "../src/lib/sensor-report";
import recorded from "../src/lib/sensor-recorded.json";
test("sensor fixture preserves original timing precision and source-independent limits", () => {
  const report = parseSensorReport(JSON.stringify(recorded));
  assert.equal(report.sharedRuns, 0);
  const watch = samplingStats(report.recordings[0]),
    sensor = samplingStats(report.recordings[1]);
  assert.equal(watch.count, 347);
  assert.equal(sensor.count, 1165);
  assert.equal(watch.median, 7);
  assert.ok(Math.abs(sensor.median - 1.920148) < 0.00001);
  assert.equal(sensor.nearCoincident, 13);
  for (const r of report.recordings) {
    const s = samplingStats(r);
    assert.equal(
      s.buckets.reduce((a, b) => a + b, 0),
      s.count - 1,
    );
    assert.equal(
      minuteCounts(r).reduce((a, b) => a + b, 0),
      s.count,
    );
  }
  assert.ok(
    !/\d{4}-\d{2}-\d{2}|uuid|Sean|bundle/i.test(JSON.stringify(report)),
  );
});
test("intervals and minute counts retain endpoint readings and long recordings", () => {
  const run = {
    label: "test",
    seconds: 86400,
    km: 5,
    meanHR: null,
    points: [
      { seconds: 0, value: 100 },
      { seconds: 60, value: 120 },
      { seconds: 86400, value: 150 },
    ],
  };
  assert.equal(minuteCounts(run).length, 1440);
  assert.equal(minuteCounts(run).at(-1), 1);
  assert.equal(samplingStats(run).count, 3);
  const input = {
    sharedRuns: 0,
    recordings: [
      run,
      {
        ...run,
        points: [
          { seconds: 0, value: 100 },
          { seconds: 0, value: 101 },
        ],
      },
    ],
  };
  assert.throws(() => parseSensorReport(JSON.stringify(input)), /increasing/);
});
test("matched-route comparisons retain only display fields and validate measurements", () => {
  const report = parseSensorReport(JSON.stringify(recorded));
  assert.equal(report.watchRuns?.length, 4);
  for (const run of report.watchRuns!) {
    assert.equal(run.routeMatch?.coveragePercent, 100);
    assert.ok(run.routeMatch!.p95Feet < 55);
    assert.ok(run.path?.startsWith("M"));
  }
  assert.equal(report.monitor?.connection, "Bluetooth Low Energy");
  const input = JSON.parse(JSON.stringify(recorded));
  input.watchRuns[0].routeMatch.coveragePercent = 101;
  assert.throws(() => parseSensorReport(JSON.stringify(input)), /route-match/);
  input.watchRuns[0].routeMatch.coveragePercent = 100;
  input.watchRuns[0].path = "<script>";
  assert.throws(() => parseSensorReport(JSON.stringify(input)), /SVG/);
  input.watchRuns[0].path = "M0,0 L1,1";
  input.monitor.sourceUrl = "javascript:alert(1)";
  assert.throws(() => parseSensorReport(JSON.stringify(input)), /HTTPS/);
});
