// Opt-in, read-only production-sized regression checks. Never writes fixtures.
import { afterAll, describe, expect, it } from "vitest";
import { getHealthPool, getPool, healthQuery, poolSize, query, scoped } from "./db";
import { getSeries } from "./data/series";

const enabled = process.env.PULS_READ_PERF === "1";
const user = process.env.PULS_READ_PERF_USER_ID ?? "";
const metrics = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierVO2Max",
  "HKQuantityTypeIdentifierBodyMass",
];

describe.skipIf(!enabled)("populated viewer read performance", () => {
  afterAll(async () => {
    await Promise.all([getPool()?.end(), getHealthPool()?.end()]);
  });

  it("uses interpreted execution on real database connections", async () => {
    expect(user).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await query("SHOW jit")).toEqual([{ jit: "off" }]);
    expect(await healthQuery("SHOW jit")).toEqual([{ jit: "off" }]);
  });

  it("loads all eight dashboard charts concurrently within 10 seconds", async () => {
    const start = performance.now();
    const series = await Promise.all(metrics.map((id) => getSeries(user, id, "30D")));
    const ms = performance.now() - start;
    console.info(`Eight dashboard charts: ${Math.round(ms)} ms`);
    expect(series.some((s) => s.points.length > 0)).toBe(true);
    expect(ms).toBeLessThan(10_000);
  }, 15_000);

  it("loads annual and all-time charts within 10 seconds each", async () => {
    for (const range of ["Y", "ALL"] as const) {
      const start = performance.now();
      const series = await getSeries(user, metrics[0], range);
      const ms = performance.now() - start;
      console.info(`${range} chart: ${Math.round(ms)} ms`);
      expect(series.points.length).toBeGreaterThan(0);
      expect(ms).toBeLessThan(10_000);
    }
  }, 25_000);

  it("probes successfully while every chart connection is occupied", async () => {
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    let ready!: () => void;
    const occupied = new Promise<void>((resolve) => { ready = resolve; });
    let count = 0;
    const reads = Array.from({ length: poolSize() }, () => scoped(user, async () => {
      if (++count === poolSize()) ready();
      await gate;
    }));
    try {
      await Promise.race([occupied, Promise.all(reads)]);
      expect(await healthQuery("SELECT 1 AS ok")).toEqual([{ ok: 1 }]);
    } finally {
      unblock();
      await Promise.allSettled(reads);
    }
  }, 10_000);
});
