"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RANGES, RANGE_ORDER } from "@/lib/metrics";
import type { RangeKey } from "@/lib/types";

export function RangeSelector({ value }: { value: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(k: RangeKey) {
    const next = new URLSearchParams(params.toString());
    next.set("range", k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="segmented" role="group" aria-label="Time range">
      {RANGE_ORDER.map((k) => (
        <button key={k} type="button" aria-pressed={value === k} aria-label={RANGES[k].label} data-active={value === k} onClick={() => select(k)}>
          {k === "6M" ? "6M" : RANGES[k].key}
        </button>
      ))}
    </div>
  );
}
