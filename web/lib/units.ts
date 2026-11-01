// Display-unit conversion. Everything is stored canonical (metric: meters, m/s);
// this layer converts for display per the viewer's preference. Stored data is
// never converted — only what the user sees.

export type UnitSystem = "metric" | "imperial";

// Independent choices default to the selected system; clinical/nutrition units
// keep their conventional defaults unless the viewer explicitly changes them.
export const UNIT_OPTIONS = {
  mass: { label: "Body weight", options: ["kg", "lb"] },
  bodyLength: { label: "Height and waist", options: ["cm", "in"] },
  temperature: { label: "Temperature", options: ["degC", "degF"] },
  energy: { label: "Energy", options: ["kcal", "kJ"] },
  volume: { label: "Water", options: ["mL", "fl oz"] },
  glucose: { label: "Blood glucose", options: ["mg/dL", "mmol/L"] },
  pressure: { label: "Blood pressure", options: ["mmHg", "kPa"] },
} as const;
export type UnitCategory = keyof typeof UNIT_OPTIONS;
export type UnitOverrides = { [K in UnitCategory]?: (typeof UNIT_OPTIONS)[K]["options"][number] };
export type UnitPreferences = UnitOverrides & { system: UnitSystem };
export function defaultUnits(system: UnitSystem): Required<UnitOverrides> {
  return { mass: system === "imperial" ? "lb" : "kg",
    bodyLength: system === "imperial" ? "in" : "cm",
    temperature: system === "imperial" ? "degF" : "degC",
    volume: system === "imperial" ? "fl oz" : "mL",
    energy: "kcal", glucose: "mg/dL", pressure: "mmHg" };
}
export function parseUnitOverrides(raw: string | null): UnitOverrides {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(UNIT_OPTIONS).flatMap(([key, config]) =>
      (config.options as readonly unknown[]).includes(parsed[key]) ? [[key, parsed[key]]] : [])) as UnitOverrides;
  } catch { return {}; }
}

export function convertMetric(identifier: string, value: number, unit: string | null, preferences: UnitPreferences): ConvertedWorkoutMetric {
  const choices = { ...defaultUnits(preferences.system), ...preferences };
  if (unit === "kg" && choices.mass === "lb") return { value: value / 0.45359237, unit: "lb" };
  if (unit === "degC" && choices.temperature === "degF") return { value: value * 1.8 + 32, unit: "degF" };
  if (unit === "kcal" && choices.energy === "kJ") return { value: value * 4.184, unit: "kJ" };
  if (unit === "mL" && choices.volume === "fl oz") return { value: value / 29.5735295625, unit: "fl oz" };
  if (unit === "mg/dL" && choices.glucose === "mmol/L") return { value: value / 18.01559, unit: "mmol/L" };
  if (unit === "mmHg" && choices.pressure === "kPa") return { value: value * 0.133322387415, unit: "kPa" };
  if (unit === "m" && /(?:Height|WaistCircumference)$/.test(identifier)) {
    return choices.bodyLength === "in" ? { value: value / 0.0254, unit: "in" } : { value: value * 100, unit: "cm" };
  }
  return convertWorkoutMetric(identifier, value, unit, preferences.system);
}

const M_PER_MI = 1609.344;
const M_PER_FT = 0.3048;
const CM_PER_IN = 2.54;

export function distanceUnit(sys: UnitSystem): string {
  return sys === "imperial" ? "mi" : "km";
}
export function elevationUnit(sys: UnitSystem): string {
  return sys === "imperial" ? "ft" : "m";
}
export function speedUnit(sys: UnitSystem): string {
  return sys === "imperial" ? "mph" : "km/h";
}
export function paceUnit(sys: UnitSystem): string {
  return sys === "imperial" ? "/mi" : "/km";
}

// meters → the big distance unit (km or mi), numeric.
export function distanceValue(meters: number, sys: UnitSystem): number {
  return sys === "imperial" ? meters / M_PER_MI : meters / 1000;
}
// meters → elevation unit (m or ft), numeric.
export function elevationValue(meters: number, sys: UnitSystem): number {
  return sys === "imperial" ? meters / M_PER_FT : meters;
}
// m/s → speed unit (km/h or mph), numeric.
export function speedValue(mps: number, sys: UnitSystem): number {
  return sys === "imperial" ? mps * 2.236936 : mps * 3.6;
}

export interface ConvertedWorkoutMetric {
  value: number;
  unit: string | null;
}

// Only convert identifiers whose physical meaning is unambiguous. A bare "m"
// can mean distance, elevation, or a short gait measurement, so the identifier
// determines whether it becomes miles or feet. Unknown metrics stay canonical.
export function convertWorkoutMetric(
  identifier: string,
  value: number,
  unit: string | null,
  sys: UnitSystem,
): ConvertedWorkoutMetric {
  if (unit === "m/s") return { value: speedValue(value, sys), unit: speedUnit(sys) };

  if (unit === "m" && identifier.includes("Distance")) {
    return { value: distanceValue(value, sys), unit: distanceUnit(sys) };
  }
  if (unit === "m" && /(Elevation|Altitude)/.test(identifier)) {
    return { value: elevationValue(value, sys), unit: elevationUnit(sys) };
  }
  if (unit === "m" && /(StrideLength|StepLength)/.test(identifier)) {
    return sys === "imperial"
      ? { value: value / M_PER_FT, unit: "ft" }
      : { value, unit: "m" };
  }
  if (unit === "cm" && /(VerticalOscillation|StrideLength|StepLength|Elevation|Altitude)/.test(identifier)) {
    return sys === "imperial"
      ? { value: value / CM_PER_IN, unit: "in" }
      : { value, unit: "cm" };
  }
  return { value, unit };
}

export function fmtDistance(meters: number | null | undefined, sys: UnitSystem): string {
  if (meters == null) return "—";
  if (sys === "metric" && meters < 1000) return `${Math.round(meters)} m`;
  return `${distanceValue(meters, sys).toFixed(2)} ${distanceUnit(sys)}`;
}

export function fmtElevation(meters: number | null | undefined, sys: UnitSystem): string {
  if (meters == null) return "—";
  return `${Math.round(elevationValue(meters, sys))} ${elevationUnit(sys)}`;
}

export function fmtSpeed(mps: number | null | undefined, sys: UnitSystem): string {
  if (mps == null) return "—";
  return `${speedValue(mps, sys).toFixed(1)} ${speedUnit(sys)}`;
}

// m/s → "m:ss /km" (or /mi). Non-moving speeds collapse to "—".
export function fmtPace(mps: number | null | undefined, sys: UnitSystem): string {
  if (mps == null || mps <= 0.1) return "—";
  const perUnit = sys === "imperial" ? M_PER_MI : 1000;
  const roundedSeconds = Math.round(perUnit / mps);
  const m = Math.floor(roundedSeconds / 60);
  const s = roundedSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")} ${paceUnit(sys)}`;
}
