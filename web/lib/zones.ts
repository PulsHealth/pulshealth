// Heart-rate zones. Apple Watch automatic zones use Heart Rate Reserve:
// resting HR + ((max HR - resting HR) * intensity). When resting HR is not
// available, keep the old max-HR percentage model as a fallback.

export interface HrZone {
  index: number; // 1..5
  name: string;
  loBpm: number | null; // null = open-ended below (Z1)
  hiBpm: number | null; // null = open-ended (Z5)
  loPct: number | null; // % of max HR for derived zones, null for explicit BPM zones
  color: string;
}

// Apple-style zone colors (cool → hot).
const ZONE_COLORS = ["#5e9bff", "#34c759", "#ffd60a", "#ff9f0a", "#ff453a"];
const ZONE_NAMES = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"];
const ZONE_PCTS = [0.5, 0.6, 0.7, 0.8, 0.9];
const HRR_ZONE_PCTS = [0.6, 0.7, 0.8, 0.9];

export function hrZones(maxHr: number, restingHr: number | null): HrZone[] {
  const hrrBounds = heartRateReserveLowerBounds(maxHr, restingHr);
  if (hrrBounds) return explicitHrZones(hrrBounds);
  return derivedHrZones(maxHr);
}

function explicitHrZones(lowerBounds: number[]): HrZone[] {
  return ZONE_NAMES.map((name, i) => {
    const loBpm = i === 0 ? null : lowerBounds[i - 1];
    const hiBpm = i === 4 ? null : lowerBounds[i] - 1;
    return {
      index: i + 1,
      name,
      loBpm,
      hiBpm,
      loPct: null,
      color: ZONE_COLORS[i],
    };
  });
}

function derivedHrZones(maxHr: number): HrZone[] {
  return ZONE_PCTS.map((lo, i) => {
    const hiPct = i < 4 ? ZONE_PCTS[i + 1] : null;
    return {
      index: i + 1,
      name: ZONE_NAMES[i],
      loBpm: Math.round(maxHr * lo),
      hiBpm: hiPct == null ? null : Math.round(maxHr * hiPct),
      loPct: Math.round(lo * 100),
      color: ZONE_COLORS[i],
    };
  });
}

function heartRateReserveLowerBounds(maxHr: number, restingHr: number | null): number[] | null {
  if (restingHr == null || !Number.isFinite(maxHr) || !Number.isFinite(restingHr)) return null;
  if (maxHr <= restingHr) return null;
  const reserve = maxHr - restingHr;
  const lowerBounds = HRR_ZONE_PCTS.map((pct) => Math.ceil(restingHr + reserve * pct));
  return isValidLowerBounds(lowerBounds) ? lowerBounds : null;
}

function isValidLowerBounds(lowerBounds: number[]): boolean {
  return lowerBounds.length === 4
    && lowerBounds.every((v, i) => Number.isFinite(v) && v > 0 && (i === 0 || v > lowerBounds[i - 1]));
}

// Which zone (1..5) a bpm falls into. The derived fallback can still return 0
// for values below 50% of max HR.
export function zoneOf(bpm: number, maxHr: number, restingHr: number | null): number {
  const lowerBounds = heartRateReserveLowerBounds(maxHr, restingHr);
  if (lowerBounds) {
    if (bpm < lowerBounds[0]) return 1;
    if (bpm < lowerBounds[1]) return 2;
    if (bpm < lowerBounds[2]) return 3;
    if (bpm < lowerBounds[3]) return 4;
    return 5;
  }
  const pct = bpm / maxHr;
  if (pct < 0.5) return 0;
  if (pct < 0.6) return 1;
  if (pct < 0.7) return 2;
  if (pct < 0.8) return 3;
  if (pct < 0.9) return 4;
  return 5;
}

// Seconds spent in each of the 5 zones, integrated from the HR stream. Each
// sample's dwell is the gap until the next sample, capped so a sparse gap
// (e.g. a pause) can't dominate.
export function timeInZones(
  points: { t: number; value: number }[],
  maxHr: number,
  restingHr: number | null,
  maxGapS = 30,
): number[] {
  const secs = [0, 0, 0, 0, 0]; // Z1..Z5
  for (let i = 0; i < points.length - 1; i++) {
    const dt = Math.min((points[i + 1].t - points[i].t) / 1000, maxGapS);
    if (dt <= 0) continue;
    const z = zoneOf(points[i].value, maxHr, restingHr);
    if (z >= 1) secs[z - 1] += dt;
  }
  return secs;
}
