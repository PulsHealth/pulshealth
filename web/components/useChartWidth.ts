"use client";

import { useEffect, useRef, useState } from "react";

// Render SVG coordinates in actual pixels so mobile labels retain their size.
export function useChartWidth(pointCount: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const resize = () => setWidth(Math.max(240, Math.round(svg.getBoundingClientRect().width)));
    const observer = new ResizeObserver(resize);
    resize();
    observer.observe(svg);
    return () => observer.disconnect();
  }, [pointCount]);
  return { ref, width };
}
