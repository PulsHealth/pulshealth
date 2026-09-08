import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BROWSABLE_CATALOG,
  CATALOG,
  GROUP_LABELS,
  GROUPS,
  typeByIdentifier,
  typeHref,
  typesInGroup,
} from "./catalog";
import { CATALOG_PROTOCOL, GENERATED_CATALOG } from "./catalog.generated";

// The published vocabulary the generated core was rendered from. `npm run
// check:catalog` guards the rendering itself; this pins the merged catalog the
// UI consumes to that file so an overlay edit can never change a fact.
const vocabulary = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../docs/protocol/catalog.json", import.meta.url)), "utf8"),
) as {
  protocol: number;
  groups: { key: string; label: string }[];
  types: { identifier: string; kind: string; unit: string | null; group: string; minimumIOS: string }[];
};

describe("catalog", () => {
  it("carries every published type with its identifier, kind, unit and group", () => {
    expect(CATALOG_PROTOCOL).toBe(vocabulary.protocol);
    expect(CATALOG.map((t) => t.identifier)).toEqual(vocabulary.types.map((t) => t.identifier));
    for (const published of vocabulary.types) {
      const type = typeByIdentifier(published.identifier);
      expect(type, published.identifier).toBeDefined();
      expect(type?.kind).toBe(published.kind);
      expect(type?.unit).toBe(published.unit);
      expect(type?.group).toBe(published.group);
      expect(type?.minimumIOS).toBe(published.minimumIOS);
    }
    expect(GENERATED_CATALOG.length).toBe(vocabulary.types.length);
  });

  it("orders and labels groups as the vocabulary does", () => {
    expect(GROUPS).toEqual(vocabulary.groups.map((g) => g.key));
    for (const g of vocabulary.groups) expect(GROUP_LABELS[g.key as (typeof GROUPS)[number]]).toBe(g.label);
  });

  it("keeps the viewer's facts for well-known types", () => {
    const steps = typeByIdentifier("HKQuantityTypeIdentifierStepCount");
    expect(steps).toMatchObject({ name: "Steps", unit: "count", kind: "quantity", group: "activity", perDay: 250 });
    expect(steps?.aggregationStyle).toBe("cumulative");
    expect(steps?.allowedAggregateFunctions).toContain("sum");
    expect(typeByIdentifier("HKQuantityTypeIdentifierOxygenSaturation")?.unit).toBe("%");
    expect(typeByIdentifier("HKCategoryTypeIdentifierSleepAnalysis")).toMatchObject({ unit: null, kind: "category", group: "sleep" });
    expect(typeByIdentifier("HKWorkoutTypeIdentifier")?.kind).toBe("workout");
    expect(typeByIdentifier("HKActivitySummaryTypeIdentifier")?.kind).toBe("activitySummary");
    expect(typeByIdentifier("NotAType")).toBeUndefined();
  });

  it("browses only kinds with viewer routes", () => {
    for (const type of BROWSABLE_CATALOG) {
      expect(["quantity", "category", "workout"]).toContain(type.kind);
      expect(typeHref(type)).not.toBeNull();
    }
    expect(typeHref(typeByIdentifier("HKWorkoutTypeIdentifier")!)).toBe("/workouts");
    expect(typeHref(typeByIdentifier("HKDataTypeIdentifierElectrocardiogram")!)).toBeNull();
    expect(typeHref(typeByIdentifier("HKActivitySummaryTypeIdentifier")!)).toBeNull();
    expect(typesInGroup("workouts").map((t) => t.identifier)).toEqual(["HKWorkoutTypeIdentifier"]);
    const browsable = new Set(BROWSABLE_CATALOG.map((t) => t.identifier));
    for (const g of GROUPS) {
      for (const type of typesInGroup(g)) expect(browsable.has(type.identifier)).toBe(true);
    }
  });
});
