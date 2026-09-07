"use client";

// Inline distance text that follows the viewer's metric/imperial preference.
// Use inside server components for lists/summaries; stored value stays metric.

import { useUnits } from "./UnitsProvider";
import { fmtDistance } from "@/lib/units";

export function Distance({ meters }: { meters: number | null | undefined }) {
  const { system } = useUnits();
  return <>{fmtDistance(meters, system)}</>;
}
