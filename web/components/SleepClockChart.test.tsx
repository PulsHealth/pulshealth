import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SleepClockChart } from "./SleepClockChart";
import { SleepChart } from "./SleepChart";
import { sleepSessions } from "@/lib/sleep";

const zone = "America/Los_Angeles";
const samples = [
  { start: Date.parse("2026-11-01T01:00:00-07:00"), end: Date.parse("2026-11-01T01:30:00-07:00"), stage: "core" as const, source: "1", sourceName: "Watch" },
  { start: Date.parse("2026-11-01T01:00:00-08:00"), end: Date.parse("2026-11-01T01:30:00-08:00"), stage: "rem" as const, source: "1", sourceName: "Watch" },
];
const sessions = sleepSessions(samples, zone);
describe("sleep chart rendering", () => {
  it("preserves both recorded stage colors in repeated clock-hour lanes", () => {
    const html = renderToStaticMarkup(<SleepClockChart days={[{ date: "2026-11-01", sessions }]} timeZone={zone} onSelect={() => {}} />);
    expect(html).toContain('data-stage="core" data-clock-lane="0/2"');
    expect(html).toContain('data-stage="rem" data-clock-lane="1/2"');
    expect(html).toContain("PDT");
    expect(html).toContain("PST");
  });
  it("shows the connected single-night chart only for the Day preset initially", () => {
    const through = Date.parse("2026-11-01T12:00:00-08:00");
    const week = renderToStaticMarkup(<SleepChart sessions={sessions} timeZone={zone} through={through} range="7D" />);
    const day = renderToStaticMarkup(<SleepChart sessions={sessions} timeZone={zone} through={through} range="D" />);
    expect(week).toContain("Sleep timing by wake date");
    expect(week).not.toContain("Connected sleep stage timeline");
    expect(week).toContain("Total in range");
    expect(day).toContain("Connected sleep stage timeline");
    expect(day).not.toContain("Sleep timing by wake date");
  });
});
