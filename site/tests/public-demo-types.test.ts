import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EXAMPLE_TYPES, personalDashboardHref, publicExampleHref, exampleDashboardHref, exampleRecords, RECORD_EXAMPLES, localViewerOrigin } from "../src/lib/public-demo-types";
import { getAllTypes } from "../src/lib/api";

test("static example coverage has knowledge-base articles and supported catalog types", async () => {
  const articles = new Map((await getAllTypes()).map(type => [type.identifier, type]));
  const catalog = JSON.parse(fs.readFileSync(new URL("../../docs/protocol/catalog.json", import.meta.url), "utf8"));
  const types = new Map<string, { kind: string }>(catalog.types.map((type: { identifier: string; kind: string }) => [type.identifier, type]));
  for (const identifier of EXAMPLE_TYPES) {
    assert.ok(articles.has(identifier), `Missing article: ${identifier}`);
    const group = RECORD_EXAMPLES.groups[identifier];
    if (group) {
      assert.equal(articles.get(identifier)?.type, "HKCorrelationType");
      for (const component of group.components) {
        assert.ok(articles.get(identifier)?.related_types?.some(related => related.identifier === component && related.relationship === "component_sample"));
        assert.equal(types.get(component)?.kind, "quantity");
        assert.ok(RECORD_EXAMPLES.samples[component]?.length);
      }
    } else assert.ok(["quantity", "category"].includes(types.get(identifier)?.kind ?? ""), `Unsupported sample type: ${identifier}`);
    assert.equal(publicExampleHref(identifier), `/knowledge-base/types/${identifier}/example/`);
    const records = exampleRecords(identifier);
    assert.ok(records && records.length > 0 && records.length <= 30);
  }
});

test("unverified metrics have no example invitation; own-data sign-in keeps its destination", () => {
  assert.equal(publicExampleHref("HKQuantityTypeIdentifierBloodGlucose"), null);
  const login = new URL(personalDashboardHref("HKQuantityTypeIdentifierRestingHeartRate"));
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("next"), "/type/HKQuantityTypeIdentifierRestingHeartRate");
  for (const identifier of ["HKCharacteristicTypeIdentifierBloodType", "HKQuantityTypeIdentifierDietaryVitaminC", "HKCategoryTypeIdentifierHeadache"]) {
    assert.equal(new URL(personalDashboardHref(identifier)).searchParams.get("next"), "/data");
  }
});

test("every article's personal destination exists in the authoritative viewer catalog", async () => {
  const catalog = JSON.parse(fs.readFileSync(new URL("../../docs/protocol/catalog.json", import.meta.url), "utf8"));
  const types = new Map<string, string>(catalog.types.map((type: { identifier: string; kind: string }) => [type.identifier, type.kind]));
  for (const article of await getAllTypes()) {
    const next = new URL(personalDashboardHref(article.identifier)).searchParams.get("next");
    if (next === "/data" || next === "/workouts") continue;
    assert.ok(["quantity", "category"].includes(types.get(article.identifier) ?? ""), `Missing viewer metric: ${article.identifier}`);
    assert.equal(next, `/type/${article.identifier}`);
  }
});


test("fixed examples retain actual sample fields, cap every type at 30, and exclude identity", () => {
  const seen = new Set<string>();
  for (const [identifier, records] of Object.entries(RECORD_EXAMPLES.samples)) {
    assert.ok(records.length > 0 && records.length <= 30);
    for (const record of records) {
      assert.equal(record.type, identifier);
      assert.ok(!seen.has(record.uuid)); seen.add(record.uuid);
      assert.match(record.uuid, /^[a-f0-9-]{36}$/);
      assert.ok(Number.isFinite(record.start) && record.end >= record.start);
      assert.ok(record.end <= Date.UTC(2025, 0, 31, 12));
      if (record.sourceName !== undefined) assert.ok(["Apple Watch", "iPhone", "Health app"].includes(record.sourceName));
      if (record.device !== undefined) assert.ok(["Apple Watch", "iPhone"].includes(record.device));
      if (record.sourceBundleID !== undefined) assert.ok(["com.apple.health", "com.apple.Health"].includes(record.sourceBundleID));
      assert.ok(!("user_id" in record) && !("deviceID" in record));
      if (record.kind === "quantity") assert.ok(typeof record.value === "number" && Boolean(record.unit));
      else assert.ok(Number.isInteger(record.category));
      for (const [key, value] of Object.entries(record.metadata ?? {})) {
        if (["HKWasUserEntered", "HKMetadataKeyWasUserEntered"].includes(key)) assert.equal(typeof value, "boolean");
        else {
          assert.ok(["HKMetadataKeyHeartRateMotionContext", "HKHeartRateMotionContext"].includes(key));
          assert.ok(typeof value === "number" && Number.isFinite(value));
        }
      }
    }
  }
});

test("development viewer overrides stay loopback-only and cannot affect production", () => {
  assert.equal(localViewerOrigin({ NODE_ENV: "production", PULS_DEV_VIEWER_ORIGIN: "http://localhost:3015" }), null);
  assert.equal(localViewerOrigin({ NODE_ENV: "development", PULS_DEV_VIEWER_ORIGIN: "http://localhost:3015" }), "http://localhost:3015");
  for (const value of ["https://example.com", "http://example.com", "http://localhost:3015/path", "http://name:secret@localhost:3015"]) {
    assert.throws(() => localViewerOrigin({ NODE_ENV: "development", PULS_DEV_VIEWER_ORIGIN: value }));
  }
});

test("dashboard links preserve the sample's metric locally and through public demo entry", () => {
  const id = "HKQuantityTypeIdentifierRestingHeartRate";
  assert.equal(exampleDashboardHref(id, { NODE_ENV: "development", PULS_DEV_VIEWER_ORIGIN: "http://localhost:3015" }), `http://localhost:3015/type/${id}?range=ALL`);
  assert.equal(exampleDashboardHref(id, { NODE_ENV: "production", PULS_DEV_VIEWER_ORIGIN: "http://localhost:3015" }), `https://app.pulshealth.com/demo?type=${id}`);
  assert.equal(exampleDashboardHref("not-an-example"), null);
  assert.ok(publicExampleHref("HKQuantityTypeIdentifierBloodPressureSystolic"));
  assert.equal(exampleDashboardHref("HKQuantityTypeIdentifierBloodPressureSystolic"), null);
});

test("blood pressure presents original component records, never fabricated paired correlations", () => {
  const id = "HKCorrelationTypeIdentifierBloodPressure";
  const records = exampleRecords(id)!;
  assert.equal(publicExampleHref(id), `/knowledge-base/types/${id}/example/`);
  assert.equal(records.length, 30);
  assert.deepEqual(new Set(records.map(record => record.type)), new Set(["HKQuantityTypeIdentifierBloodPressureSystolic", "HKQuantityTypeIdentifierBloodPressureDiastolic"]));
  for (const record of records) {
    assert.equal(record.kind, "quantity");
    assert.equal(record.unit, "mmHg");
    assert.ok(RECORD_EXAMPLES.samples[record.type].includes(record));
    assert.ok(!("systolic" in record) && !("diastolic" in record) && !("correlation" in record));
  }
  assert.equal(exampleDashboardHref(id), null);
});
