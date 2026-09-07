import { smoothPath, makeScale, type Pt } from "@/lib/chart";

// A compact, non-interactive trend glyph for cards. Pure SVG, server-rendered.
export function Sparkline({
  values,
  color,
  width = 132,
  height = 40,
  fill = true,
  strokeWidth = 1.75,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  fill?: boolean;
  strokeWidth?: number;
}) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <line x1="0" y1={height - 4} x2={width} y2={height - 4} stroke="var(--border)" strokeDasharray="2 4" />
      </svg>
    );
  }
  // Horizontal pad keeps the end dot off the edges; vertical pad must also absorb
  // the cardinal-spline overshoot at sharp peaks plus the end-dot radius (2.6),
  // otherwise the curve/dot escape the box (we clip overflow below).
  const padX = 3;
  const padY = 6;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const sx = makeScale(0, vals.length - 1, padX, width - padX);
  const sy = makeScale(min, max, height - padY, padY);
  const pts: Pt[] = vals.map((v, i) => [sx(i), sy(v)]);
  const d = smoothPath(pts, 0.6);
  const area = `${d} L ${pts[pts.length - 1][0]} ${height} L ${pts[0][0]} ${height} Z`;
  const id = `sl-${color.replace(/[^a-z0-9]/gi, "")}`;
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: "block", overflow: "hidden" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.6} fill={color} />
    </svg>
  );
}
