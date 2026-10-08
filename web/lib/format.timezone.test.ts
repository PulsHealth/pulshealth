import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBucket, formatDay, formatFull, formatMonth, formatTime, formatToday, formatWindow, tickLabel } from "./format";

afterEach(() => vi.unstubAllEnvs());

describe("account date formatting", () => {
  const instant = Date.parse("2026-08-01T00:30:00Z");
  const west = "America/Los_Angeles";
  const east = "Asia/Tokyo";
  const day = 86_400_000;

  it("uses the account zone across midnight, independent of the server default", () => {
    vi.stubEnv("PULS_TIME_ZONE", "UTC");
    expect(formatDay(instant, west)).toBe("Jul 31");
    expect(formatDay(instant, east)).toBe("Aug 1");
    expect(formatFull(instant, west)).toContain("Jul 31");
    expect(formatFull(instant, east)).toContain("Aug 1");
    expect(formatToday(new Date(instant), west)).toContain("July 31");
    expect(formatMonth(instant, west)).toBe("Jul 2026");
    expect(formatMonth(instant, east)).toBe("Aug 2026");
  });

  it("keeps chart ticks, tooltips and window readouts in the same account zone", () => {
    expect(tickLabel(instant, 3_600_000, west)).toBe(formatTime(instant, west));
    expect(tickLabel(instant, day, west)).toBe("Jul 31");
    expect(tickLabel(instant, 30 * day, west)).toBe("Jul 2026");
    expect(formatBucket(instant, day, west)).toContain("Jul 31");
    expect(formatBucket(instant, 30 * day, west)).toBe("Jul 2026");
    expect(formatWindow(instant, instant + 3_600_000, day, west)).toContain("Jul 31");
    expect(formatWindow(instant, instant + 3_600_000, 30 * day, west)).toBe("Jul 2026");
  });

  it("does not leak one account's formatting into another account", () => {
    expect(formatDay(instant, west)).toBe("Jul 31");
    expect(formatDay(instant, east)).toBe("Aug 1");
    expect(formatDay(instant, west)).toBe("Jul 31");
  });
});
