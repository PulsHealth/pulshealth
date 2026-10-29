import catalog from "../../../docs/protocol/catalog.json";

// The examples are frozen public excerpts, independent of the live viewer.
import snapshot from "./record-examples.json";

export interface ExampleRecord {
  uuid: string;
  type: string;
  kind: "quantity" | "category";
  start: number;
  end: number;
  value?: number;
  unit?: string;
  category?: number;
  sourceName?: string;
  sourceBundleID?: string;
  device?: string;
  metadata?: Record<string, unknown>;
}

export const RECORD_EXAMPLES = snapshot as { version: number; provenance: string; samples: Record<string, ExampleRecord[]> };
export const EXAMPLE_TYPES = new Set(Object.keys(RECORD_EXAMPLES.samples));

export function publicExampleHref(identifier: string): string | null {
  return EXAMPLE_TYPES.has(identifier)
    ? `/knowledge-base/types/${encodeURIComponent(identifier)}/example/`
    : null;
}

// Local open-mode viewers need no account bootstrap. Ignore this setting in
// production so a local preview can never leak into an exported website.
export function localViewerOrigin(env: Record<string, string | undefined> = process.env): string | null {
  if (env.NODE_ENV !== "development" || !env.PULS_DEV_VIEWER_ORIGIN) return null;
  const url = new URL(env.PULS_DEV_VIEWER_ORIGIN);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PULS_DEV_VIEWER_ORIGIN must be a loopback HTTP origin");
  }
  return url.origin;
}

const viewerTypes = new Map(catalog.types.map(type => [type.identifier, type.kind]));

export function personalDashboardHref(identifier: string): string {
  const kind = viewerTypes.get(identifier);
  const next = kind === "quantity" || kind === "category"
    ? `/type/${encodeURIComponent(identifier)}`
    : kind === "workout" ? "/workouts" : "/data";
  const local = localViewerOrigin();
  return local ? `${local}${next}?range=ALL` : `https://app.pulshealth.com/login?next=${encodeURIComponent(next)}`;
}
