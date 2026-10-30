import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ q: vi.fn(), scoped: vi.fn() }));
vi.mock("../db", () => ({ scoped: mocks.scoped }));
vi.mock("../reportingTimeZone", () => ({ reportingTimeZone: async () => "America/Los_Angeles" }));
vi.mock("./source", () => ({ liveRead: async (_: string, _demo: unknown, read: () => unknown) => read() }));
import { getSleepSessions } from "./sleep";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.scoped.mockImplementation(async (_user, read) => read(mocks.q));
  mocks.q.mockResolvedValue([]);
});
describe("sleep read", () => {
  it("scopes the user and bounds both timestamps with a type InitPlan", async () => {
    expect(await getSleepSessions("user-a")).toEqual([]);
    expect(mocks.scoped).toHaveBeenCalledWith("user-a", expect.any(Function));
    const [sql, params] = mocks.q.mock.calls[0];
    expect(sql).toContain("c.user_id = $1::uuid");
    expect(sql).toContain("c.type_id = (SELECT type_id FROM sample_types WHERE identifier = $2)");
    expect(sql).toContain("c.start_ts >= $3::timestamptz");
    expect(sql).toContain("c.start_ts < $4::timestamptz");
    expect(params.slice(0, 2)).toEqual(["user-a", "HKCategoryTypeIdentifierSleepAnalysis"]);
    expect(params[3].getTime() - params[2].getTime()).toBe(32 * 86400_000);
  });
  it("decodes known values and ignores unknown future values", async () => {
    const start = Date.now() - 3600_000;
    mocks.q.mockResolvedValue([1, 99].map((value) => ({ start: String(start), end: String(start + 600_000), value, source: "1", source_name: "Watch" })));
    const result = await getSleepSessions("user-a");
    expect(result[0].sources[0].asleep).toBe(10);
    expect(result[0].sources[0].minutes.unspecified).toBe(10);
  });
  it("propagates failed reads instead of returning an empty history", async () => {
    mocks.q.mockRejectedValue(new Error("query failed"));
    await expect(getSleepSessions("user-a")).rejects.toThrow("query failed");
  });
});
