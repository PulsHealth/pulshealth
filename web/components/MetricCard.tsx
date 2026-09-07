import Link from "next/link";
import { typeHref, type HealthType } from "@/lib/catalog";
import { GROUP_COLOR } from "@/lib/colors";
import { displayUnit, formatCompact, relativeTime } from "@/lib/format";
import { ArrowDown, ArrowUp } from "./Icons";
import { Sparkline } from "./Sparkline";

export function MetricCard({
  type,
  value,
  unit,
  spark,
  t,
}: {
  type: HealthType;
  value: number | null;
  unit: string | null;
  spark: number[];
  t?: number | null;
}) {
  const color = GROUP_COLOR[type.group];
  const u = displayUnit(unit ?? type.unit);
  const href = typeHref(type);
  if (!href) return null;

  // trend = last vs first half mean
  let delta: number | null = null;
  const clean = spark.filter(Number.isFinite);
  if (clean.length >= 4) {
    const half = Math.floor(clean.length / 2);
    const a = clean.slice(0, half).reduce((x, y) => x + y, 0) / half;
    const b = clean.slice(half).reduce((x, y) => x + y, 0) / (clean.length - half);
    if (a !== 0) delta = ((b - a) / Math.abs(a)) * 100;
  }

  return (
    <Link href={href} className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="dot" style={{ background: color }} />
          <span style={{ color: "var(--fg-soft)", fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {type.name}
          </span>
        </div>
        {delta != null && Math.abs(delta) >= 1 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 11.5,
              color: delta >= 0 ? "#30d158" : "#ff6b6b",
            }}
            className="mono"
          >
            {delta >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 14 }}>
        <div>
          <div className="metric-num" style={{ fontSize: 30, fontWeight: 600 }}>
            {formatCompact(value)}
            {u && <span style={{ fontSize: 13, fontWeight: 400, color: "var(--muted)", marginLeft: 4 }}>{u}</span>}
          </div>
          {t != null && (
            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>{relativeTime(t)}</div>
          )}
        </div>
        <Sparkline values={spark} color={color} />
      </div>
    </Link>
  );
}
