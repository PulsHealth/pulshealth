#!/usr/bin/env node
// Renders lib/catalog.generated.ts from the published type vocabulary,
// ../docs/protocol/catalog.json (itself rendered from the Swift
// HealthTypeCatalog by the PulsHealthSync package tests — see
// docs/protocol/catalog.md). Identifiers, kinds, units, groups and display
// names reach the web viewer only through this file, so they cannot drift
// from the app. Standard library only: no dependencies to install.
//
//   node scripts/gen-catalog.mjs          # npm run gen:catalog — (re)write the file
//   node scripts/gen-catalog.mjs --check  # npm run check:catalog — render to a temp
//                                         # file, diff against the committed one,
//                                         # exit 1 with the first difference

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.resolve(webRoot, "..", "docs", "protocol", "catalog.json");
const TARGET = path.resolve(webRoot, "lib", "catalog.generated.ts");

const ENTRY_KEYS = [
  "identifier",
  "kind",
  "unit",
  "aggregationStyle",
  "allowedAggregateFunctions",
  "minimumIOS",
  "displayName",
  "group",
  "estimatedSamplesPerDay",
];

class VocabularyError extends Error {}

function fail(message) {
  throw new VocabularyError(message);
}

const isString = (v) => typeof v === "string" && v.length > 0;
const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0;

/** Validates the vocabulary's shape and returns it typed enough to render. */
export function validate(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail("top level must be an object");
  if (!Number.isInteger(doc.protocol) || doc.protocol < 1) fail("`protocol` must be a positive integer");
  if (!isString(doc.source)) fail("`source` must name the Swift catalog");
  if (!Array.isArray(doc.groups) || doc.groups.length === 0) fail("`groups` must be a non-empty array");
  if (!Array.isArray(doc.types) || doc.types.length === 0) fail("`types` must be a non-empty array");

  const groupKeys = new Set();
  for (const group of doc.groups) {
    if (!isString(group?.key) || !isString(group?.label)) fail("every group needs a `key` and a `label`");
    if (!/^[a-z]+$/.test(group.key)) fail(`group key ${JSON.stringify(group.key)} is not a lowercase word`);
    if (groupKeys.has(group.key)) fail(`duplicate group key ${group.key}`);
    groupKeys.add(group.key);
  }

  const identifiers = new Set();
  let previous = "";
  doc.types.forEach((type, index) => {
    const where = `types[${index}]`;
    if (!type || typeof type !== "object") fail(`${where} must be an object`);
    const keys = Object.keys(type);
    if (keys.length !== ENTRY_KEYS.length || !ENTRY_KEYS.every((k, i) => keys[i] === k)) {
      fail(`${where} keys must be exactly ${ENTRY_KEYS.join(", ")} in that order (got ${keys.join(", ")})`);
    }
    if (!isString(type.identifier)) fail(`${where} needs an identifier`);
    const label = `${where} (${type.identifier})`;
    if (identifiers.has(type.identifier)) fail(`${label} is a duplicate identifier`);
    identifiers.add(type.identifier);
    if (type.identifier <= previous) fail(`${label} is out of order: entries are sorted by identifier`);
    previous = type.identifier;

    if (!isString(type.kind)) fail(`${label} needs a kind`);
    if (type.unit !== null && !isString(type.unit)) fail(`${label} unit must be a string or null`);
    if (type.aggregationStyle !== null && !isString(type.aggregationStyle)) {
      fail(`${label} aggregationStyle must be a string or null`);
    }
    if (!Array.isArray(type.allowedAggregateFunctions) || !type.allowedAggregateFunctions.every(isString)) {
      fail(`${label} allowedAggregateFunctions must be an array of strings`);
    }
    if (type.kind === "quantity") {
      if (type.unit === null) fail(`${label} is a quantity type without a unit`);
      if (type.aggregationStyle === null) fail(`${label} is a quantity type without an aggregation style`);
    } else {
      if (type.unit !== null) fail(`${label} is not a quantity type but has a unit`);
      if (type.aggregationStyle !== null) fail(`${label} is not a quantity type but has an aggregation style`);
      if (type.allowedAggregateFunctions.length !== 0) fail(`${label} is not a quantity type but has aggregate functions`);
    }
    if (!/^\d+\.\d+$/.test(type.minimumIOS ?? "")) fail(`${label} minimumIOS must look like "18.0"`);
    if (!isString(type.displayName)) fail(`${label} needs a displayName`);
    if (!groupKeys.has(type.group)) fail(`${label} has unknown group ${JSON.stringify(type.group)}`);
    if (!isNonNegativeInt(type.estimatedSamplesPerDay)) fail(`${label} estimatedSamplesPerDay must be a non-negative integer`);
  });
  return doc;
}

const union = (values) => [...new Set(values)].sort().map((v) => JSON.stringify(v)).join(" | ");

/** The TypeScript module for a validated vocabulary. */
export function render(doc) {
  const kinds = union(doc.types.map((t) => t.kind));
  const groups = doc.groups.map((g) => JSON.stringify(g.key)).join(" | ");
  const styles = union(doc.types.map((t) => t.aggregationStyle).filter((s) => s !== null));
  const functions = union(doc.types.flatMap((t) => t.allowedAggregateFunctions));

  const lines = [
    "// GENERATED by scripts/gen-catalog.mjs from ../docs/protocol/catalog.json — do not edit.",
    `// The vocabulary is rendered from ${doc.source} by the PulsHealthSync`,
    "// package tests; regenerate this file with `npm run gen:catalog` after that JSON changes",
    "// (`npm run check:catalog` fails in CI when the two disagree). Web-only additions belong",
    "// in ./catalog.ts, which merges them over this core.",
    "",
    "/** The Puls Sync Protocol major version this vocabulary belongs to. */",
    `export const CATALOG_PROTOCOL = ${doc.protocol};`,
    "",
    "/** Sample kinds, as the app's `SampleKind` names them. */",
    `export type Kind = ${kinds};`,
    "",
    "/** Apple-Health-style groups, in the app's display order. */",
    `export type Group = ${groups};`,
    "",
    "/** HealthKit `HKQuantityAggregationStyle` case names (quantity types only). */",
    `export type AggregationStyle = ${styles};`,
    "",
    "/** Aggregate functions the app can compute on-device (`AggregateFunction` in Swift). */",
    `export type AggregateFunction = ${functions};`,
    "",
    "export interface GeneratedHealthType {",
    "  /** HealthKit identifier, e.g. \"HKQuantityTypeIdentifierStepCount\" — matches sample_types.identifier in Postgres. */",
    "  readonly identifier: string;",
    "  readonly kind: Kind;",
    "  /** Canonical unit every value is converted to on the phone (HKUnit string); null for non-quantity kinds. */",
    "  readonly unit: string | null;",
    "  readonly aggregationStyle: AggregationStyle | null;",
    "  /** Functions HealthKit accepts for this type's aggregation style; empty for non-quantity kinds. */",
    "  readonly allowedAggregateFunctions: readonly AggregateFunction[];",
    "  /** First iOS release the app exports this type on, e.g. \"18.0\". */",
    "  readonly minimumIOS: string;",
    "  /** The app's display name. */",
    "  readonly displayName: string;",
    "  readonly group: Group;",
    "  /** Rough expected samples per active day (the app's backfill-ETA hint). */",
    "  readonly estimatedSamplesPerDay: number;",
    "}",
    "",
    "export const CATALOG_GROUPS: readonly { readonly key: Group; readonly label: string }[] = [",
    ...doc.groups.map((g) => `  { key: ${JSON.stringify(g.key)}, label: ${JSON.stringify(g.label)} },`),
    "];",
    "",
    "/** Every type the app can sync, sorted by identifier. */",
    "export const GENERATED_CATALOG: readonly GeneratedHealthType[] = [",
    ...doc.types.map((t) => {
      const fields = ENTRY_KEYS.map((k) => `${k}: ${JSON.stringify(t[k])}`).join(", ");
      return `  { ${fields} },`;
    }),
    "];",
    "",
  ];
  return lines.join("\n");
}

function load() {
  let text;
  try {
    text = readFileSync(SOURCE, "utf8");
  } catch (err) {
    fail(`cannot read ${SOURCE}: ${err.message}`);
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    fail(`${SOURCE} is not valid JSON: ${err.message}`);
  }
  // The file is canonical JSON.stringify(doc, null, 2) output, so any hand edit
  // that survives parsing still shows up here.
  if (text !== `${JSON.stringify(doc, null, 2)}\n`) {
    fail(`${SOURCE} is not in its canonical layout; regenerate it from the Swift catalog (docs/protocol/catalog.md)`);
  }
  return validate(doc);
}

function firstDifference(committed, generated) {
  const a = committed.split("\n");
  const b = generated.split("\n");
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return `line ${i + 1}:\n  committed: ${a[i]}\n  generated: ${b[i]}`;
  }
  if (a.length !== b.length) {
    return `line ${n + 1}: the ${a.length > b.length ? "committed" : "generated"} file has ${Math.abs(a.length - b.length)} more line(s)`;
  }
  return "identical text, different bytes";
}

function main(argv) {
  const check = argv.includes("--check");
  const rendered = render(load());
  const relative = path.relative(process.cwd(), TARGET);

  if (!check) {
    writeFileSync(TARGET, rendered);
    console.log(`gen-catalog: wrote ${relative}`);
    return 0;
  }

  const dir = mkdtempSync(path.join(tmpdir(), "puls-catalog-"));
  const scratch = path.join(dir, "catalog.generated.ts");
  try {
    writeFileSync(scratch, rendered);
    let committed;
    try {
      committed = readFileSync(TARGET, "utf8");
    } catch {
      committed = null;
    }
    const fresh = readFileSync(scratch, "utf8");
    if (committed === fresh) {
      console.log(`gen-catalog: ${relative} is up to date`);
      return 0;
    }
    console.error(
      committed === null
        ? `gen-catalog: ${relative} is missing`
        : `gen-catalog: ${relative} is out of date with docs/protocol/catalog.json\nFirst difference at ${firstDifference(committed, fresh)}`,
    );
    console.error("Run `npm run gen:catalog` and commit the result.");
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof VocabularyError) {
      console.error(`gen-catalog: ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  }
}
