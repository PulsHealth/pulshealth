"use client";
import { useRef, useState, forwardRef } from "react";
import { ACTIVITIES, ACTIVITY_COLORS, type Activity } from "@/lib/example-data";
import type { Report, ReportRoute } from "@/lib/example-report";
import { MONTH_NAMES } from "@/lib/example-report";
import { exportImage, saveText } from "./export-image";
import { number, hours } from "./report-visuals";
import styles from "./examples.module.css";
const PALETTES = {
  night: {
    bg: "#101d2e",
    fg: "#e9f3ff",
    muted: "#a5bbd1",
    colors: ["#74c9ff", "#c9b7f5", "#f5c985", "#b3cfde"],
  },
  paper: {
    bg: "#eef2f6",
    fg: "#162b42",
    muted: "#50677f",
    colors: ["#236ea4", "#8159a9", "#a46920", "#4b6e6a"],
  },
  copper: {
    bg: "#201c1c",
    fg: "#f4e5d9",
    muted: "#c0a99b",
    colors: ["#e5b68f", "#d9c8b8", "#ba7c61", "#f2dcc2"],
  },
};
type Palette = keyof typeof PALETTES;
type Composition = "collection" | "layers" | "orbit";
export const ArtPoster = forwardRef<
  SVGSVGElement,
  {
    report: Report;
    routes: ReportRoute[];
    mode: Composition;
    palette: Palette;
    title: string;
    weight: number;
    compact?: boolean;
  }
>(function ArtPoster(
  { report, routes, mode, palette, title, weight, compact },
  ref,
) {
  const p = PALETTES[palette],
    count =
      mode === "collection"
        ? Math.min(routes.length, 48)
        : Math.min(routes.length, 185),
    draw = routes.slice(0, count),
    columns = count > 24 ? 8 : 6,
    cell = 624 / columns;
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 800"
      role="img"
      aria-label={`${title}: ${draw.length} recorded route shapes`}
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      <title>{title}</title>
      <rect width="720" height="800" fill={p.bg} />
      <text x="48" y="65" fill={p.muted} fontSize="15">
        {report.year} · Movement study
      </text>
      <g>
        {draw.map((route, i) => {
          const color = p.colors[ACTIVITIES.indexOf(route.activity)];
          const transform =
            mode === "collection"
              ? `translate(${48 + (i % columns) * cell} ${155 + Math.floor(i / columns) * cell * 1.08}) scale(${cell / 116})`
              : mode === "orbit"
                ? `translate(360 374) rotate(${(i / draw.length) * 360}) scale(3.8) translate(-68 -54)`
                : `translate(0 150)`;
          return (
            <path
              key={route.id}
              d={mode === "layers" ? route.path : route.shape}
              transform={transform}
              stroke={color}
              vectorEffect="non-scaling-stroke"
              strokeWidth={mode === "orbit" ? weight * 0.7 : weight}
              strokeOpacity={
                mode === "collection" ? 0.9 : mode === "orbit" ? 0.3 : 0.36
              }
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </g>
      <text
        x="48"
        y="710"
        fill={p.fg}
        fontSize={compact ? 32 : title.length > 24 ? 29 : 38}
        fontWeight="500"
      >
        {title.slice(0, 38)}
      </text>
      <text x="48" y="749" fill={p.muted} fontSize="15">
        {number(draw.length)} routes ·{" "}
        {mode === "collection"
          ? "A collection of familiar paths"
          : mode === "orbit"
            ? "Route shapes, rotated into a new form"
            : "A year of paths in one place"}
      </text>
      <text x="48" y="779" fill={p.muted} fontSize="12">
        Made with PulsHealth
      </text>
    </svg>
  );
});
export function ArtStudio({
  report,
  compact = false,
}: {
  report: Report;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<Composition>("collection"),
    [palette, setPalette] = useState<Palette>("night"),
    [activity, setActivity] = useState<Activity | "All">("All"),
    [count, setCount] = useState(24),
    [weight, setWeight] = useState(1.8),
    [title, setTitle] = useState("A year of movement"),
    [offset, setOffset] = useState(0),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null),
    matching = report.routes.filter(
      (r) => activity === "All" || r.activity === activity,
    ),
    shift = matching.length ? offset % matching.length : 0,
    routes = [...matching.slice(shift), ...matching.slice(0, shift)].slice(
      0,
      mode === "collection" ? count : 185,
    );
  async function image(share = false) {
    if (!svg.current) return;
    setBusy(true);
    try {
      setStatus(
        await exportImage(svg.current, `activity-art-${report.year}`, share),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not export image");
    } finally {
      setBusy(false);
    }
  }
  if (compact)
    return (
      <ArtPoster
        report={report}
        routes={report.routes.slice(0, 24)}
        mode="collection"
        palette="night"
        title="A year of movement"
        weight={1.8}
        compact
      />
    );
  return (
    <div className={styles.studio}>
      <div className={styles.artwork}>
        <ArtPoster
          ref={svg}
          report={report}
          routes={routes}
          mode={mode}
          palette={palette}
          title={title}
          weight={weight}
        />
      </div>
      <aside className={styles.editor}>
        <h2>Make it yours.</h2>
        <label>
          Title
          <input
            value={title}
            maxLength={38}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Composition</legend>
          <div className={styles.segment}>
            {(
              [
                ["collection", "Collection"],
                ["layers", "Layers"],
                ["orbit", "Orbit"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Palette</legend>
          <div className={styles.segment}>
            {Object.keys(PALETTES).map((value) => (
              <button
                key={value}
                aria-pressed={palette === value}
                onClick={() => setPalette(value as Palette)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Activity
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value as Activity | "All")}
          >
            {["All", ...ACTIVITIES].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        {mode === "collection" && (
          <label>
            Routes
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              <option value={12}>12 routes</option>
              <option value={24}>24 routes</option>
              <option value={48}>48 routes</option>
            </select>
          </label>
        )}
        <label>
          Line weight
          <input
            type="range"
            min=".6"
            max="4"
            step=".2"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </label>
        <button
          className={styles.quietButton}
          onClick={() => setOffset(offset + Math.max(1, count))}
        >
          Another selection
        </button>
        <div className={styles.exportButtons}>
          <button
            className={styles.primaryButton}
            disabled={busy || routes.length === 0}
            onClick={() => image()}
          >
            Save PNG
          </button>
          <button
            disabled={busy || routes.length === 0}
            onClick={() => image(true)}
          >
            Share
          </button>
          <button
            disabled={routes.length === 0}
            onClick={() => {
              if (svg.current)
                saveText(
                  new XMLSerializer().serializeToString(svg.current),
                  "activity-art.svg",
                  "image/svg+xml",
                );
            }}
          >
            SVG
          </button>
        </div>
        <p className={styles.status} role="status">
          {status}
        </p>
        {!routes.length && <p>No routes match this activity.</p>}
      </aside>
    </div>
  );
}
export function RouteAtlas({
  report,
  compact = false,
}: {
  report: Report;
  compact?: boolean;
}) {
  const [activity, setActivity] = useState<Activity | "All">("All"),
    [month, setMonth] = useState(12),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [selected, setSelected] = useState<string | null>(null),
    [status, setStatus] = useState("");
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{
      x: number;
      y: number;
      px: number;
      py: number;
      routeId: string | null;
    } | null>(null),
    moved = useRef(false);
  const routes = report.routes.filter(
      (r) =>
        (activity === "All" || r.activity === activity) && r.month <= month,
    ),
    chosen = routes.find((r) => r.id === selected),
    km = routes.reduce((n, r) => n + (r.km ?? 0), 0);
  const drawing = (
    <svg
      ref={svg}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 520"
      role="img"
      aria-label={`${routes.length} recorded routes layered in shared geography; north up`}
      style={{
        touchAction: compact ? undefined : "none",
        fontFamily: "Arial, sans-serif",
      }}
      onPointerDown={
        compact
          ? undefined
          : (e) => {
              moved.current = false;
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                px: pan.x,
                py: pan.y,
                routeId: (e.target as Element).getAttribute("data-route"),
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }
      }
      onPointerMove={
        compact
          ? undefined
          : (e) => {
              if (!drag.current) return;
              const scale = 720 / e.currentTarget.getBoundingClientRect().width;
              const dx = (e.clientX - drag.current.x) * scale,
                dy = (e.clientY - drag.current.y) * scale;
              if (Math.abs(dx) + Math.abs(dy) > 5) moved.current = true;
              setPan({ x: drag.current.px + dx, y: drag.current.py + dy });
            }
      }
      onPointerUp={
        compact
          ? undefined
          : () => {
              if (!moved.current && drag.current?.routeId)
                setSelected(drag.current.routeId);
              drag.current = null;
            }
      }
      onPointerCancel={
        compact
          ? undefined
          : () => {
              drag.current = null;
            }
      }
    >
      <title>Activity atlas</title>
      <defs>
        <clipPath id={compact ? "atlas-preview-clip" : "atlas-clip"}>
          <rect x="20" y="45" width="680" height="410" rx="8" />
        </clipPath>
      </defs>
      <rect width="720" height="520" fill="#101d2e" />
      <g clipPath={`url(#${compact ? "atlas-preview-clip" : "atlas-clip"})`}>
        <g
          transform={`translate(${360 + pan.x} ${260 + pan.y}) scale(${zoom}) translate(-360 -210)`}
        >
          {routes.map((r) => (
            <path
              key={r.id}
              data-route={r.id}
              d={r.path}
              fill="none"
              stroke={ACTIVITY_COLORS[r.activity]}
              strokeWidth={selected === r.id ? 3 : 1.3}
              strokeOpacity={selected ? (selected === r.id ? 1 : 0.12) : 0.4}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              onClick={
                compact
                  ? undefined
                  : () => {
                      if (!moved.current) setSelected(r.id);
                    }
              }
            >
              <title>
                {r.activity} · {MONTH_NAMES[r.month - 1]} · {number(r.km === null ? null : r.km * 0.621371192, 1)} mi
              </title>
            </path>
          ))}
        </g>
      </g>
      <text x="34" y="29" fontSize="13" fill="#a5bbd1">
        {report.year} · {routes.length} paths
      </text>
      <text x="680" y="29" fontSize="13" fill="#a5bbd1" textAnchor="end">
        N ↑
      </text>
      <text x="34" y="491" fontSize="14" fill="#a5bbd1">
        Walks. Runs. Rides. A place made familiar.
      </text>
    </svg>
  );
  if (compact) return drawing;
  return (
    <div className={styles.atlas}>
      <div className={styles.atlasToolbar}>
        <div className={styles.filterChips}>
          {["All", ...ACTIVITIES].map((a) => (
            <button
              key={a}
              aria-pressed={activity === a}
              onClick={() => {
                setActivity(a as Activity | "All");
                setSelected(null);
              }}
            >
              {a}
            </button>
          ))}
        </div>
        <div className={styles.zoomButtons}>
          <button
            aria-label="Zoom out"
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
          >
            −
          </button>
          <span>{number(zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            onClick={() => setZoom(Math.min(5, zoom + 0.25))}
          >
            +
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
              setSelected(null);
            }}
          >
            Reset
          </button>
        </div>
      </div>
      <div className={styles.atlasSurface}>{drawing}</div>
      <div className={styles.atlasBottom}>
        <label>
          Year unfolding<span>{MONTH_NAMES[month - 1]}</span>
          <input
            aria-label="Show routes through month"
            type="range"
            min="1"
            max="12"
            value={month}
            onChange={(e) => {
              setMonth(Number(e.target.value));
              setSelected(null);
            }}
          />
        </label>
        <div className={styles.miniStats}>
          <div>
            <strong>{routes.length}</strong>
            <span>routes shown</span>
          </div>
          <div>
            <strong>{number(km * 0.621371192)}</strong>
            <span>recorded miles</span>
          </div>
          <div>
            <strong>{hours(routes.reduce((n, r) => n + r.minutes, 0))}</strong>
            <span>on these routes</span>
          </div>
        </div>
      </div>
      <div className={styles.routeInspector}>
        {chosen ? (
          <>
            <strong>
              {chosen.activity} · {MONTH_NAMES[chosen.month - 1]}
            </strong>
            <span>{number(chosen.km === null ? null : chosen.km * 0.621371192, 1)} mi</span>
            <span>{hours(chosen.minutes)}</span>
            <button onClick={() => setSelected(null)}>Show all</button>
          </>
        ) : (
          <span>Drag to explore. Choose a route to see its details.</span>
        )}
        <button
          onClick={() => {
            const index = routes.findIndex((r) => r.id === selected);
            setSelected(
              routes[(index + 1) % Math.max(1, routes.length)]?.id ?? null,
            );
          }}
        >
          Next route
        </button>
        <button
          onClick={async () => {
            try {
              if (svg.current)
                setStatus(
                  await exportImage(
                    svg.current,
                    `activity-atlas-${report.year}`,
                  ),
                );
            } catch {
              setStatus("Could not export the atlas.");
            }
          }}
        >
          Save image
        </button>
        <button onClick={async () => {try {if (svg.current) setStatus(await exportImage(svg.current, `activity-atlas-${report.year}`, true));} catch {setStatus("Could not share the atlas.");}}}>Share image</button>
      </div>
      <p role="status" className={styles.status}>
        {status}
      </p>
      {!routes.length && <p>No routes match this selection.</p>}
    </div>
  );
}
