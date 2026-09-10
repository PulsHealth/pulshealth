"use client";

import { RouteMap } from "./RouteMap";
import { useClientPref } from "@/lib/clientPref";
import { MAP_STYLES, mapStylePref, writeMapStyle, type MapStyleId } from "@/lib/mapStyles";
import type { RoutePoint } from "@/lib/types";

// A small synthetic loop (around Central Park) purely to preview tile styles.
function sampleRoute(): RoutePoint[] {
  const oLat = 40.7825;
  const oLon = -73.9655;
  const r = 0.012;
  const n = 64;
  const pts: RoutePoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI * 2;
    pts.push({
      t: i * 30_000,
      lat: oLat + r * 0.7 * Math.sin(a),
      lon: oLon + r * Math.cos(a) * 0.55,
      altitude: null,
      speed: null,
    });
  }
  return pts;
}

// Constant for the life of the module: the preview loop never changes, and a
// stable reference keeps RouteMap from rebuilding its map on every render.
const SAMPLE_ROUTE = sampleRoute();

export function MapStyleSettings() {
  // No local copy of the selection: writeMapStyle notifies every subscriber,
  // so the preview below and any open map re-render from the same source.
  const selected = useClientPref(mapStylePref);

  function choose(id: MapStyleId) {
    writeMapStyle(id); // persists + notifies the preview / any open map
  }

  return (
    <>
      <div className="panel rise" style={{ padding: 14, marginBottom: 18 }}>
        <RouteMap route={SAMPLE_ROUTE} color="#30d158" height={260} />
        <p style={{ margin: "12px 4px 2px", fontSize: 12, color: "var(--faint)" }}>
          Live preview · map tiles are fetched from the selected provider when you view a route.
        </p>
      </div>

      <div
        className="rise"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, animationDelay: "40ms" }}
      >
        {MAP_STYLES.map((s) => {
          const active = selected === s.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={active}
              onClick={() => choose(s.id)}
              className="panel panel-tight"
              data-active={active}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                textAlign: "left",
                padding: 12,
                cursor: "pointer",
                background: "transparent",
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 12,
                outline: active ? "1px solid var(--accent)" : "none",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  flex: "none",
                  background: s.swatch,
                  border: "1px solid var(--border)",
                  boxShadow: active ? "0 0 0 2px var(--accent) inset" : "none",
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 550 }}>
                  {s.label}
                  {active && <span className="dot" style={{ background: "var(--accent)" }} />}
                </span>
                <span style={{ display: "block", fontSize: 12, color: "var(--faint)", marginTop: 3, lineHeight: 1.4 }}>
                  {s.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
