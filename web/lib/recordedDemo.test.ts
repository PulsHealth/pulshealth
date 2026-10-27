import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordedDemo, recordedSeries, type RecordedDemo } from "./recordedDemo";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });

it("keeps a private preview file out of production even when configured", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PULS_DEMO_PREVIEW_FILE", "/missing/private-file.json");
  expect(recordedDemo()).toBeNull();
});

it("fails visibly for a configured invalid preview rather than fabricating data", () => {
  const dir = mkdtempSync(join(tmpdir(), "recorded-demo-")); dirs.push(dir);
  const path = join(dir, "preview.json"); writeFileSync(path, "{}");
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("PULS_DEMO_PREVIEW_FILE", path);
  expect(() => recordedDemo()).toThrow("Invalid private demo snapshot");
});

it("preserves local daily dates across daylight saving and leaves missing metrics empty", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
  const identifier = "HKQuantityTypeIdentifierHeartRate";
  const points = ["2026-11-01T07:00:00Z", "2026-11-02T08:00:00Z"].map((t, i) => ({ t: Date.parse(t), value: 70 + i, min: 60, max: 80, count: 2 }));
  const data: RecordedDemo = { version: 1, generatedAt: Date.now(), today: Date.parse("2026-11-03T08:00:00Z"),
    timeZone: "America/Los_Angeles", daily: { [identifier]: points }, hourly: {}, workouts: [], workoutSeries: {}, latest: {}, stats: [],
    rings: { date: null, moveMode: 0, moveKcal: 0, moveGoalKcal: 600, exerciseMin: 0, exerciseGoalMin: 30,
      standHours: 0, standGoalHours: 12, moveTimeMin: null, moveTimeGoalMin: null, hasData: false } };
  expect(recordedSeries(data, identifier, "7D").points).toEqual(points);
  expect(recordedSeries(data, "missing", "ALL").points).toEqual([]);
});
