import fs from "fs";
import path from "path";

/**
 * The published type vocabulary, `docs/protocol/catalog.json`, rendered from
 * `HealthTypeCatalog.swift` by the library's tests. Read at build time so the
 * site's "what the app syncs" list is the real one rather than a hand copy.
 */

export interface CatalogGroup {
  key: string;
  label: string;
}

export interface CatalogType {
  identifier: string;
  kind: "quantity" | "category" | "workout" | "activitySummary" | string;
  unit: string | null;
  minimumIOS: string;
  displayName: string;
  group: string;
}

export interface Catalog {
  protocol: number;
  groups: CatalogGroup[];
  types: CatalogType[];
}

const CATALOG_PATH = path.join(process.cwd(), "..", "docs", "protocol", "catalog.json");

let cached: Catalog | null = null;

export function getCatalog(): Catalog {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(CATALOG_PATH, "utf8");
    cached = JSON.parse(raw) as Catalog;
  } catch (error) {
    console.error(`Catalog not found at ${CATALOG_PATH}`, error);
    cached = { protocol: 1, groups: [], types: [] };
  }
  return cached;
}

export function getCatalogByGroup(): { group: CatalogGroup; types: CatalogType[] }[] {
  const catalog = getCatalog();
  return catalog.groups
    .map((group) => ({
      group,
      types: catalog.types
        .filter((t) => t.group === group.key)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }))
    .filter((entry) => entry.types.length > 0);
}
