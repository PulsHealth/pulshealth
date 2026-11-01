import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExampleData,
  routePaths,
  sampleData,
  trainingWeeks,
  type ExampleData,
} from "../src/lib/example-data";

describe("showcase data boundaries", () => {
  test("rejects duplicate identity, impossible dates and invalid measurements", () => {
    for (const mutate of [
      (d: ExampleData) => d.workouts.push(d.workouts[0]),
      (d: ExampleData) => {
        d.workouts[0].date = "2025-02-30";
      },
      (d: ExampleData) => {
        d.workouts[0].distanceM = -1;
      },
      (d: ExampleData) => {
        d.workouts[0].route = [{ lat: 91, lon: 0 }];
      },
    ]) {
      const copy = sampleData();
      mutate(copy);
      assert.throws(() => parseExampleData(JSON.stringify(copy)));
    }
  });
  test("preserves missing distance and never trusts an imported label", () => {
    const data = parseExampleData(
      JSON.stringify({ ...sampleData(), label: "Untrusted claim" }),
    );
    assert.equal(data.label, "Your local file");
    assert.equal(
      data.workouts.find((w) => w.id === "synthetic-missing-distance")
        ?.distanceM,
      null,
    );
  });
  test("keeps empty weeks and excludes only the selected race and future workouts", () => {
    const data: ExampleData = {
      label: "Test",
      year: 2025,
      raceDate: "2025-10-19",
      raceId: "race",
      workouts: [
        {
          id: "run",
          date: "2025-10-13",
          activity: "Running",
          distanceM: 10000,
          durationS: 3600,
        },
        {
          id: "unknown",
          date: "2025-10-14",
          activity: "Running",
          distanceM: null,
          durationS: 1800,
        },
        {
          id: "race",
          date: "2025-10-19",
          activity: "Running",
          distanceM: 42195,
          durationS: 15000,
        },
        {
          id: "future",
          date: "2025-10-20",
          activity: "Running",
          distanceM: 5000,
          durationS: 1800,
        },
      ],
    };
    const weeks = trainingWeeks(data);
    assert.equal(weeks.length, 16);
    assert.equal(weeks[0].date, "2025-06-30");
    assert.ok(weeks.slice(0, -1).every((w) => w.count === 0));
    assert.deepEqual(weeks[15], {
      date: "2025-10-13",
      km: 10,
      longest: 10,
      count: 2,
      missing: 1,
    });
  });
  test("a week with only unknown distances has no invented longest run", () => {
    const data = sampleData();
    data.workouts = [
      {
        id: "unknown",
        date: "2025-10-13",
        activity: "Running",
        distanceM: null,
        durationS: 1800,
      },
    ];
    delete data.raceId;
    const last = trainingWeeks(data)[15];
    assert.equal(last.longest, null);
    assert.equal(last.missing, 1);
    assert.equal(last.count, 1);
  });
  test("route projection preserves shared positions and stationary points", () => {
    const common = {
      activity: "Walking" as const,
      date: "2025-01-01",
      distanceM: 10,
      durationS: 10,
    };
    const routes = [
      {
        ...common,
        id: "west",
        route: [
          { lat: 60, lon: 1 },
          { lat: 60.01, lon: 1.02 },
        ],
      },
      {
        ...common,
        id: "east",
        route: [
          { lat: 60, lon: 2 },
          { lat: 60.01, lon: 2.02 },
        ],
      },
    ];
    const shared = routePaths(routes, false);
    const x = (d: string) => Number(d.match(/^M([\d.]+)/)![1]);
    assert.ok(x(shared[0].d) < x(shared[1].d));
    const stationary = routePaths(
      [
        {
          ...routes[0],
          route: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 0 },
          ],
        },
      ],
      false,
    );
    assert.equal(stationary[0].d, "M360.00,210.00 L360.00,210.00");
  });
});
