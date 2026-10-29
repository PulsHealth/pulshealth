import catalog from "../../../docs/protocol/catalog.json";

// Public-demo coverage verified in a fresh, signed-out browser on 2026-10-29.
// This is a presentation allowlist, not a type catalog. Keep only identifiers
// with records in the public demo and a working /type/ viewer page; never infer
// public availability from a private account or from article figures.
export const PUBLIC_DEMO_TYPES = new Set([
  "HKQuantityTypeIdentifierPhysicalEffort",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierAppleStandTime",
  "HKQuantityTypeIdentifierWalkingSpeed",
  "HKQuantityTypeIdentifierWalkingStepLength",
  "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage",
  "HKQuantityTypeIdentifierBasalEnergyBurned",
  "HKCategoryTypeIdentifierAppleStandHour",
  "HKQuantityTypeIdentifierWalkingAsymmetryPercentage",
  "HKQuantityTypeIdentifierRunningPower",
  "HKQuantityTypeIdentifierRunningSpeed",
  "HKQuantityTypeIdentifierRunningVerticalOscillation",
  "HKQuantityTypeIdentifierRunningGroundContactTime",
  "HKQuantityTypeIdentifierRunningStrideLength",
  "HKQuantityTypeIdentifierAppleExerciseTime",
  "HKQuantityTypeIdentifierDistanceCycling",
  "HKQuantityTypeIdentifierFlightsClimbed",
  "HKQuantityTypeIdentifierVO2Max",
  "HKQuantityTypeIdentifierDistanceSwimming",
  "HKQuantityTypeIdentifierSwimmingStrokeCount",
  "HKQuantityTypeIdentifierHeartRate",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierWalkingHeartRateAverage",
  "HKQuantityTypeIdentifierHeartRateRecoveryOneMinute",
  "HKQuantityTypeIdentifierBodyMass",
  "HKQuantityTypeIdentifierRespiratoryRate",
  "HKQuantityTypeIdentifierOxygenSaturation",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKQuantityTypeIdentifierTimeInDaylight",
]);

export function publicDemoHref(identifier: string): string | null {
  return PUBLIC_DEMO_TYPES.has(identifier)
    ? `https://app.pulshealth.com/demo?type=${encodeURIComponent(identifier)}`
    : null;
}

const viewerTypes = new Map(catalog.types.map(type => [type.identifier, type.kind]));

export function personalDashboardHref(identifier: string): string {
  const kind = viewerTypes.get(identifier);
  const next = kind === "quantity" || kind === "category"
    ? `/type/${encodeURIComponent(identifier)}`
    : kind === "workout" ? "/workouts" : "/data";
  return `https://app.pulshealth.com/login?next=${encodeURIComponent(next)}`;
}
