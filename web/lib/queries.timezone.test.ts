import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ query: queryMock }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STEPS = "HKQuantityTypeIdentifierStepCount";

let warnSpy: ReturnType<typeof vi.spyOn>;

// The database-zone lookup is cached at module scope, so every test imports a
// fresh copy of ./queries.
beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_URL = "postgres://test";
  process.env.PULS_USER_ID = USER_ID;
  process.env.PULS_TIME_ZONE = "Europe/Berlin";
  queryMock.mockReset();
  warnSpy?.mockRestore();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

function mockDatabase(zoneLookup: () => Promise<unknown[]>) {
  queryMock.mockImplementation((text: string) => {
    if (text.includes("puls_time_zone()")) return zoneLookup();
    if (text.includes("SELECT DISTINCT identifier FROM metric_daily")) {
      return Promise.resolve([{ identifier: STEPS }]);
    }
    return Promise.resolve([]);
  });
}

const sqlCalls = () => queryMock.mock.calls.map(([sql]) => sql as string);
const touchedMetricDaily = () => sqlCalls().some((sql) => sql.includes("metric_daily"));
const usedMetricDailySeries = () =>
  sqlCalls().some((sql) => sql.includes("FROM metric_daily") && sql.includes("GROUP BY 1 ORDER BY 1"));
const usedRawBuckets = () => sqlCalls().some((sql) => sql.includes("WITH per_source"));
const zoneLookups = () => sqlCalls().filter((sql) => sql.includes("puls_time_zone()")).length;

describe("metric_daily zone guard", () => {
  it("uses metric_daily when the database's zone equals PULS_TIME_ZONE", async () => {
    mockDatabase(() => Promise.resolve([{ zone: "Europe/Berlin" }]));
    const { getSeries } = await import("./queries");
    await getSeries(STEPS, "Y");

    expect(usedMetricDailySeries()).toBe(true);
    expect(usedRawBuckets()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to raw local buckets and warns once on a zone mismatch", async () => {
    mockDatabase(() => Promise.resolve([{ zone: "UTC" }]));
    const { getDailySparklines, getSeries } = await import("./queries");
    await getSeries(STEPS, "Y");
    await getDailySparklines([STEPS]);

    expect(touchedMetricDaily()).toBe(false);
    expect(usedRawBuckets()).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("Europe/Berlin");
    expect(String(warnSpy.mock.calls[0][0])).toContain("UTC");
  });

  it("falls back and warns once when puls_time_zone() does not exist", async () => {
    mockDatabase(() => Promise.reject(new Error("function puls_time_zone() does not exist")));
    const { getSeries } = await import("./queries");
    await getSeries(STEPS, "Y");
    await getSeries(STEPS, "M");

    expect(touchedMetricDaily()).toBe(false);
    expect(usedRawBuckets()).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("looks the database zone up once and reuses it", async () => {
    mockDatabase(() => Promise.resolve([{ zone: "Europe/Berlin" }]));
    const { getDailySparklines, getSeries } = await import("./queries");
    await Promise.all([getSeries(STEPS, "Y"), getSeries(STEPS, "M")]);
    await getDailySparklines([STEPS]);

    expect(zoneLookups()).toBe(1);
    expect(usedMetricDailySeries()).toBe(true);
  });
});
