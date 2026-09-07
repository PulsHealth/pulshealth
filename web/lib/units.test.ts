import { describe, expect, it } from "vitest";
import { convertWorkoutMetric, fmtPace } from "./units";

describe("fmtPace", () => {
  it("carries rounded seconds into the next minute", () => {
    expect(fmtPace(1000 / 299.6, "metric")).toBe("5:00 /km");
  });

  it("formats ordinary pace", () => {
    expect(fmtPace(1000 / 270, "metric")).toBe("4:30 /km");
  });
});

describe("convertWorkoutMetric", () => {
  it("uses miles for cumulative distance and feet for short meter lengths", () => {
    expect(convertWorkoutMetric("HKQuantityTypeIdentifierDistanceWalkingRunning", 1609.344, "m", "imperial"))
      .toEqual({ value: 1, unit: "mi" });
    expect(convertWorkoutMetric("HKQuantityTypeIdentifierRunningStrideLength", 1, "m", "imperial"))
      .toEqual({ value: 1 / 0.3048, unit: "ft" });
    expect(convertWorkoutMetric("HKQuantityTypeIdentifierElevationAscended", 100, "m", "imperial"))
      .toEqual({ value: 100 / 0.3048, unit: "ft" });
  });

  it("converts known centimeter gait metrics to inches", () => {
    expect(convertWorkoutMetric("HKQuantityTypeIdentifierRunningVerticalOscillation", 2.54, "cm", "imperial"))
      .toEqual({ value: 1, unit: "in" });
  });

  it("leaves ambiguous meter metrics unchanged", () => {
    expect(convertWorkoutMetric("HKQuantityTypeIdentifierHeight", 1.8, "m", "imperial"))
      .toEqual({ value: 1.8, unit: "m" });
  });
});
