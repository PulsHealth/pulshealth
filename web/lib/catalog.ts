// Ported from PulsHealthSync/Sources/PulsHealthSync/Models/HealthTypeCatalog.swift
// Source of truth for type identifiers, display names, units, and Apple-Health-style groupings.

export type Kind =
  | "quantity"
  | "category"
  | "workout"
  | "heartbeatSeries"
  | "ecg"
  | "stateOfMind"
  | "medicationDose";

export type Group =
  | "activity"
  | "heart"
  | "body"
  | "respiratory"
  | "sleep"
  | "nutrition"
  | "vitals"
  | "workouts"
  | "other";

export interface HealthType {
  /** HealthKit identifier, e.g. "HKQuantityTypeIdentifierStepCount" — primary key, matches sample_types.identifier in Postgres */
  identifier: string;
  /** Human-friendly display name, e.g. "Heart Rate" */
  name: string;
  /** Canonical unit string, e.g. "count/min", or null for category/workout/series kinds */
  unit: string | null;
  kind: Kind;
  group: Group;
  /** estimatedSamplesPerDay density hint */
  perDay: number;
}

export const CATALOG: HealthType[] = [
  // Quantity — Activity
  { identifier: "HKQuantityTypeIdentifierStepCount", name: "Steps", unit: "count", kind: "quantity", group: "activity", perDay: 250 },
  { identifier: "HKQuantityTypeIdentifierDistanceWalkingRunning", name: "Walking + Running Distance", unit: "m", kind: "quantity", group: "activity", perDay: 250 },
  { identifier: "HKQuantityTypeIdentifierDistanceCycling", name: "Cycling Distance", unit: "m", kind: "quantity", group: "activity", perDay: 20 },
  { identifier: "HKQuantityTypeIdentifierFlightsClimbed", name: "Flights Climbed", unit: "count", kind: "quantity", group: "activity", perDay: 30 },
  { identifier: "HKQuantityTypeIdentifierActiveEnergyBurned", name: "Active Energy", unit: "kcal", kind: "quantity", group: "activity", perDay: 700 },
  { identifier: "HKQuantityTypeIdentifierBasalEnergyBurned", name: "Resting Energy", unit: "kcal", kind: "quantity", group: "activity", perDay: 350 },
  { identifier: "HKQuantityTypeIdentifierAppleExerciseTime", name: "Exercise Minutes", unit: "min", kind: "quantity", group: "activity", perDay: 60 },
  { identifier: "HKQuantityTypeIdentifierAppleStandTime", name: "Stand Minutes", unit: "min", kind: "quantity", group: "activity", perDay: 60 },
  { identifier: "HKQuantityTypeIdentifierAppleMoveTime", name: "Move Minutes", unit: "min", kind: "quantity", group: "activity", perDay: 60 },
  { identifier: "HKQuantityTypeIdentifierWalkingSpeed", name: "Walking Speed", unit: "m/s", kind: "quantity", group: "activity", perDay: 60 },
  { identifier: "HKQuantityTypeIdentifierWalkingStepLength", name: "Step Length", unit: "m", kind: "quantity", group: "activity", perDay: 60 },
  { identifier: "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage", name: "Double Support %", unit: "%", kind: "quantity", group: "activity", perDay: 60 },
  { identifier: "HKQuantityTypeIdentifierWalkingAsymmetryPercentage", name: "Walking Asymmetry %", unit: "%", kind: "quantity", group: "activity", perDay: 30 },
  { identifier: "HKQuantityTypeIdentifierRunningSpeed", name: "Running Speed", unit: "m/s", kind: "quantity", group: "activity", perDay: 50 },
  { identifier: "HKQuantityTypeIdentifierRunningPower", name: "Running Power", unit: "W", kind: "quantity", group: "activity", perDay: 50 },
  { identifier: "HKQuantityTypeIdentifierRunningGroundContactTime", name: "Ground Contact Time", unit: "ms", kind: "quantity", group: "activity", perDay: 50 },
  { identifier: "HKQuantityTypeIdentifierRunningVerticalOscillation", name: "Vertical Oscillation", unit: "cm", kind: "quantity", group: "activity", perDay: 50 },
  { identifier: "HKQuantityTypeIdentifierRunningStrideLength", name: "Running Stride Length", unit: "m", kind: "quantity", group: "activity", perDay: 50 },
  { identifier: "HKQuantityTypeIdentifierCyclingPower", name: "Cycling Power", unit: "W", kind: "quantity", group: "activity", perDay: 50 },
  { identifier: "HKQuantityTypeIdentifierCyclingCadence", name: "Cycling Cadence", unit: "count/min", kind: "quantity", group: "activity", perDay: 50 },
  { identifier: "HKQuantityTypeIdentifierCyclingSpeed", name: "Cycling Speed", unit: "m/s", kind: "quantity", group: "activity", perDay: 50 },
  { identifier: "HKQuantityTypeIdentifierDistanceSwimming", name: "Swimming Distance", unit: "m", kind: "quantity", group: "activity", perDay: 5 },
  { identifier: "HKQuantityTypeIdentifierSwimmingStrokeCount", name: "Swimming Strokes", unit: "count", kind: "quantity", group: "activity", perDay: 5 },
  { identifier: "HKQuantityTypeIdentifierVO2Max", name: "VO₂ Max", unit: "ml/kg*min", kind: "quantity", group: "activity", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierPhysicalEffort", name: "Physical Effort", unit: "kcal/hr*kg", kind: "quantity", group: "activity", perDay: 100 },

  // Quantity — Heart
  { identifier: "HKQuantityTypeIdentifierHeartRate", name: "Heart Rate", unit: "count/min", kind: "quantity", group: "heart", perDay: 3500 },
  { identifier: "HKQuantityTypeIdentifierRestingHeartRate", name: "Resting Heart Rate", unit: "count/min", kind: "quantity", group: "heart", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierWalkingHeartRateAverage", name: "Walking HR Average", unit: "count/min", kind: "quantity", group: "heart", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", name: "HRV (SDNN)", unit: "ms", kind: "quantity", group: "heart", perDay: 8 },
  { identifier: "HKQuantityTypeIdentifierHeartRateRecoveryOneMinute", name: "HR Recovery (1 min)", unit: "count/min", kind: "quantity", group: "heart", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierAtrialFibrillationBurden", name: "AFib Burden", unit: "%", kind: "quantity", group: "heart", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierPeripheralPerfusionIndex", name: "Perfusion Index", unit: "%", kind: "quantity", group: "heart", perDay: 1 },

  // Quantity — Body
  { identifier: "HKQuantityTypeIdentifierBodyMass", name: "Body Weight", unit: "kg", kind: "quantity", group: "body", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierBodyMassIndex", name: "BMI", unit: "count", kind: "quantity", group: "body", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierBodyFatPercentage", name: "Body Fat %", unit: "%", kind: "quantity", group: "body", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierLeanBodyMass", name: "Lean Body Mass", unit: "kg", kind: "quantity", group: "body", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierHeight", name: "Height", unit: "m", kind: "quantity", group: "body", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierWaistCircumference", name: "Waist Circumference", unit: "m", kind: "quantity", group: "body", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierBodyTemperature", name: "Body Temperature", unit: "degC", kind: "quantity", group: "body", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierBasalBodyTemperature", name: "Basal Body Temperature", unit: "degC", kind: "quantity", group: "body", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierAppleSleepingWristTemperature", name: "Wrist Temperature (Sleep)", unit: "degC", kind: "quantity", group: "sleep", perDay: 1 },

  // Quantity — Respiratory / Vitals / Other
  { identifier: "HKQuantityTypeIdentifierRespiratoryRate", name: "Respiratory Rate", unit: "count/min", kind: "quantity", group: "respiratory", perDay: 120 },
  { identifier: "HKQuantityTypeIdentifierOxygenSaturation", name: "Blood Oxygen", unit: "%", kind: "quantity", group: "respiratory", perDay: 30 },
  { identifier: "HKQuantityTypeIdentifierBloodPressureSystolic", name: "Blood Pressure (Systolic)", unit: "mmHg", kind: "quantity", group: "vitals", perDay: 2 },
  { identifier: "HKQuantityTypeIdentifierBloodPressureDiastolic", name: "Blood Pressure (Diastolic)", unit: "mmHg", kind: "quantity", group: "vitals", perDay: 2 },
  { identifier: "HKQuantityTypeIdentifierBloodGlucose", name: "Blood Glucose", unit: "mg/dL", kind: "quantity", group: "vitals", perDay: 10 },
  { identifier: "HKQuantityTypeIdentifierBloodAlcoholContent", name: "Blood Alcohol Content", unit: "%", kind: "quantity", group: "vitals", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierNumberOfTimesFallen", name: "Falls", unit: "count", kind: "quantity", group: "vitals", perDay: 1 },
  { identifier: "HKQuantityTypeIdentifierEnvironmentalAudioExposure", name: "Environmental Sound", unit: "dBASPL", kind: "quantity", group: "other", perDay: 50 },
  { identifier: "HKQuantityTypeIdentifierHeadphoneAudioExposure", name: "Headphone Audio", unit: "dBASPL", kind: "quantity", group: "other", perDay: 30 },
  { identifier: "HKQuantityTypeIdentifierEnvironmentalSoundReduction", name: "Sound Reduction", unit: "dBASPL", kind: "quantity", group: "other", perDay: 30 },
  { identifier: "HKQuantityTypeIdentifierTimeInDaylight", name: "Time in Daylight", unit: "min", kind: "quantity", group: "other", perDay: 20 },
  { identifier: "HKQuantityTypeIdentifierUVExposure", name: "UV Exposure", unit: "count", kind: "quantity", group: "other", perDay: 5 },

  // Quantity — Nutrition
  { identifier: "HKQuantityTypeIdentifierDietaryEnergyConsumed", name: "Dietary Energy", unit: "kcal", kind: "quantity", group: "nutrition", perDay: 5 },
  { identifier: "HKQuantityTypeIdentifierDietaryProtein", name: "Protein", unit: "g", kind: "quantity", group: "nutrition", perDay: 5 },
  { identifier: "HKQuantityTypeIdentifierDietaryCarbohydrates", name: "Carbohydrates", unit: "g", kind: "quantity", group: "nutrition", perDay: 5 },
  { identifier: "HKQuantityTypeIdentifierDietaryFatTotal", name: "Total Fat", unit: "g", kind: "quantity", group: "nutrition", perDay: 5 },
  { identifier: "HKQuantityTypeIdentifierDietaryFiber", name: "Fiber", unit: "g", kind: "quantity", group: "nutrition", perDay: 5 },
  { identifier: "HKQuantityTypeIdentifierDietarySugar", name: "Sugar", unit: "g", kind: "quantity", group: "nutrition", perDay: 5 },
  { identifier: "HKQuantityTypeIdentifierDietarySodium", name: "Sodium", unit: "mg", kind: "quantity", group: "nutrition", perDay: 5 },
  { identifier: "HKQuantityTypeIdentifierDietaryCaffeine", name: "Caffeine", unit: "mg", kind: "quantity", group: "nutrition", perDay: 3 },
  { identifier: "HKQuantityTypeIdentifierDietaryWater", name: "Water", unit: "mL", kind: "quantity", group: "nutrition", perDay: 8 },

  // Category
  { identifier: "HKCategoryTypeIdentifierSleepAnalysis", name: "Sleep Stages", unit: null, kind: "category", group: "sleep", perDay: 40 },
  { identifier: "HKCategoryTypeIdentifierAppleStandHour", name: "Stand Hours", unit: null, kind: "category", group: "activity", perDay: 16 },
  { identifier: "HKCategoryTypeIdentifierMindfulSession", name: "Mindful Minutes", unit: null, kind: "category", group: "other", perDay: 2 },
  { identifier: "HKCategoryTypeIdentifierHighHeartRateEvent", name: "High HR Events", unit: null, kind: "category", group: "heart", perDay: 1 },
  { identifier: "HKCategoryTypeIdentifierLowHeartRateEvent", name: "Low HR Events", unit: null, kind: "category", group: "heart", perDay: 1 },
  { identifier: "HKCategoryTypeIdentifierIrregularHeartRhythmEvent", name: "Irregular Rhythm Events", unit: null, kind: "category", group: "heart", perDay: 1 },
  { identifier: "HKCategoryTypeIdentifierLowCardioFitnessEvent", name: "Low Cardio Fitness Events", unit: null, kind: "category", group: "heart", perDay: 1 },
  { identifier: "HKCategoryTypeIdentifierHandwashingEvent", name: "Handwashing Events", unit: null, kind: "category", group: "other", perDay: 5 },
  { identifier: "HKCategoryTypeIdentifierToothbrushingEvent", name: "Toothbrushing Events", unit: null, kind: "category", group: "other", perDay: 2 },
  { identifier: "HKCategoryTypeIdentifierEnvironmentalAudioExposureEvent", name: "Loud Environment Events", unit: null, kind: "category", group: "other", perDay: 1 },
  { identifier: "HKCategoryTypeIdentifierHeadphoneAudioExposureEvent", name: "Loud Headphone Events", unit: null, kind: "category", group: "other", perDay: 1 },
  { identifier: "HKCategoryTypeIdentifierSleepApneaEvent", name: "Sleep Apnea Events", unit: null, kind: "category", group: "sleep", perDay: 1 },

  // Special / series types
  { identifier: "HKDataTypeIdentifierHeartbeatSeries", name: "Heartbeat Series (beat-to-beat)", unit: null, kind: "heartbeatSeries", group: "heart", perDay: 6 },
  { identifier: "HKDataTypeIdentifierElectrocardiogram", name: "ECG", unit: null, kind: "ecg", group: "heart", perDay: 1 },
  { identifier: "HKDataTypeIdentifierStateOfMind", name: "State of Mind", unit: null, kind: "stateOfMind", group: "other", perDay: 2 },
  { identifier: "HKMedicationDoseEventTypeIdentifierMedicationDoseEvent", name: "Medication Doses", unit: null, kind: "medicationDose", group: "other", perDay: 3 },

  // Workouts
  { identifier: "HKWorkoutTypeIdentifier", name: "Workouts", unit: null, kind: "workout", group: "workouts", perDay: 2 },
];

export const GROUPS: Group[] = [
  "activity", "heart", "body", "respiratory", "sleep", "nutrition", "vitals", "workouts", "other",
];

export const GROUP_LABELS: Record<Group, string> = {
  activity: "Activity",
  heart: "Heart",
  body: "Body",
  respiratory: "Respiratory",
  sleep: "Sleep",
  nutrition: "Nutrition",
  vitals: "Vitals",
  workouts: "Workouts",
  other: "Other",
};

const BY_ID = new Map(CATALOG.map((t) => [t.identifier, t]));

// Quantity, category, and workout records have complete viewer routes. The
// remaining series-like tables are synced, but do not yet have honest detail
// views, so keep them out of navigation until those views exist.
export const BROWSABLE_CATALOG = CATALOG.filter((t) =>
  t.kind === "quantity" || t.kind === "category" || t.kind === "workout",
);

export function typeByIdentifier(id: string): HealthType | undefined {
  return BY_ID.get(id);
}
export function typesInGroup(g: Group): HealthType[] {
  return BROWSABLE_CATALOG.filter((t) => t.group === g);
}
export function typeHref(type: HealthType): string | null {
  if (type.kind === "workout") return "/workouts";
  if (type.kind === "quantity" || type.kind === "category") {
    return `/type/${encodeURIComponent(type.identifier)}`;
  }
  return null;
}
