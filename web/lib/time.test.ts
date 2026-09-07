import { describe, expect, it } from "vitest";
import { greetingAt, hourInTimeZone } from "./time";

describe("application time zone", () => {
  const instant = new Date("2026-07-10T06:30:00Z");

  it("derives the hour in the requested zone", () => {
    expect(hourInTimeZone(instant, "America/Los_Angeles")).toBe(23);
    expect(hourInTimeZone(instant, "UTC")).toBe(6);
  });

  it("uses that local hour for greetings", () => {
    expect(greetingAt(instant, "America/Los_Angeles")).toBe("Good evening");
    expect(greetingAt(instant, "UTC")).toBe("Good morning");
  });
});
