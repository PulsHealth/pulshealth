// Display-unit conversion. Everything is stored canonical (metric: meters, m/s);
// this layer converts for display per the viewer's preference. Stored data is
// never converted — only what the user sees.

export type UnitSystem = "metric" | "imperial";

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
