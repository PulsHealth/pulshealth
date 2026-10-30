import { describe, expect, it } from "vitest";
import { convertWorkoutMetric, convertMetric, defaultUnits, parseUnitOverrides, fmtPace } from "./units";

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

describe("viewer-wide display preferences", () => {
  const imperial = { system: "imperial" } as const;
  it.each([
    ["BodyMass", 0.45359237, "kg", 1, "lb"],
    ["LeanBodyMass", 0.90718474, "kg", 2, "lb"],
    ["Height", 1.778, "m", 70, "in"],
    ["WaistCircumference", 1.016, "m", 40, "in"],
    ["BodyTemperature", 0, "degC", 32, "degF"],
    ["AppleSleepingWristTemperature", 37, "degC", 98.6, "degF"],
    ["DietaryWater", 29.5735295625, "mL", 1, "fl oz"],
    ["DistanceCycling", 1609.344, "m", 1, "mi"],
    ["WalkingSpeed", 0.44704, "m/s", 1, "mph"],
  ])("converts %s with the imperial preset", (id, value, unit, expected, label) => {
    const result = convertMetric(`HKQuantityTypeIdentifier${id}`, value as number, unit as string, imperial);
    expect(result.value).toBeCloseTo(expected as number, 5);
    expect(result.unit).toBe(label);
  });

  it("applies independent choices, including in a metric preset", () => {
    const prefs = { system: "metric", mass: "lb", temperature: "degF", bodyLength: "in", energy: "kJ", volume: "fl oz", glucose: "mmol/L", pressure: "kPa" } as const;
    expect(convertMetric("", 10, "kcal", prefs)).toEqual({ value: 41.84, unit: "kJ" });
    expect(convertMetric("", 180.1559, "mg/dL", prefs).value).toBeCloseTo(10);
    expect(convertMetric("", 120, "mmHg", prefs).value).toBeCloseTo(15.9986865);
    expect(convertMetric("", 1, "kg", prefs).unit).toBe("lb");
    expect(convertMetric("", 1, "mL", prefs).unit).toBe("fl oz");
    expect(convertMetric("HKQuantityTypeIdentifierHeight", 1, "m", prefs).unit).toBe("in");
  });

  it("converts absolute temperatures consistently across a min/average/max band", () => {
    expect([0, 10, 20].map((v) => convertMetric("", v, "degC", imperial).value)).toEqual([32, 50, 68]);
  });

  it("uses centimeters for metric body lengths, retaining conventional specialized units", () => {
    expect(convertMetric("HKQuantityTypeIdentifierHeight", 1.8, "m", { system: "metric" })).toEqual({ value: 180, unit: "cm" });
    for (const unit of ["g", "mg", "ml/kg*min", "kcal/hr*kg", "%", "count/min", "ms", null]) {
      expect(convertMetric("Unknown", 42, unit, imperial)).toEqual({ value: 42, unit });
    }
    expect(convertMetric("Unknown", 42, "m", imperial)).toEqual({ value: 42, unit: "m" });
  });

  it("validates persisted overrides and safely ignores corrupt or unknown choices", () => {
    expect(parseUnitOverrides('{"mass":"lb","energy":"kJ","temperature":"invalid","other":"in"}')).toEqual({ mass: "lb", energy: "kJ" });
    for (const raw of [null, "null", "broken", "[]", "1"]) expect(parseUnitOverrides(raw)).toEqual({});
    expect(defaultUnits("imperial")).toMatchObject({ mass: "lb", temperature: "degF", energy: "kcal", glucose: "mg/dL" });
  });
});
