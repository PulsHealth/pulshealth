"use client";

import { useUnits } from "./UnitsProvider";
import { convertMetric } from "@/lib/units";
import { displayUnit, formatCompact, formatValue } from "@/lib/format";

export function MetricValue({ identifier, value, unit, compact = false, unitStyle }: {
  identifier: string; value: number | null; unit: string | null; compact?: boolean; unitStyle?: React.CSSProperties;
}) {
  const { preferences } = useUnits();
  const converted = convertMetric(identifier, value ?? 0, unit, preferences);
  const label = displayUnit(converted.unit);
  return <>{(compact ? formatCompact : formatValue)(value == null ? null : converted.value)}{label && <span style={unitStyle}> {label}</span>}</>;
}

export function MetricUnit({ identifier, unit }: { identifier: string; unit: string | null }) {
  const { preferences } = useUnits();
  return <>{displayUnit(convertMetric(identifier, 0, unit, preferences).unit)}</>;
}
