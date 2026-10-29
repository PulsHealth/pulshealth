import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EXAMPLE_TYPES, personalDashboardHref, publicExampleHref, RECORD_EXAMPLES, localViewerOrigin } from "../src/lib/public-demo-types";
import { getAllTypes } from "../src/lib/api";

test("static example coverage has knowledge-base articles and supported catalog types", async () => {
  const articles = new Set((await getAllTypes()).map(type => type.identifier));
  const catalog = JSON.parse(fs.readFileSync(new URL("../../docs/protocol/catalog.json", import.meta.url), "utf8"));
  const types = new Map<string, { kind: string }>(catalog.types.map((type: { identifier: string; kind: string }) => [type.identifier, type]));
  for (const identifier of EXAMPLE_TYPES) {
    assert.ok(articles.has(identifier), `Missing article: ${identifier}`);
    assert.ok(["quantity", "category"].includes(types.get(identifier)?.kind ?? ""), `Unsupported viewer route: ${identifier}`);
    assert.equal(publicExampleHref(identifier), `/knowledge-base/types/${identifier}/example/`);
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
      assert.ok(["Apple Watch", "iPhone"].includes(record.sourceName!));
      assert.ok(["Apple Watch", "iPhone"].includes(record.device!));
      assert.ok(!("user_id" in record) && !("deviceID" in record));
      if (record.kind === "quantity") assert.ok(typeof record.value === "number" && Boolean(record.unit));
      else assert.ok(Number.isInteger(record.category));
      for (const key of Object.keys(record.metadata ?? {})) assert.equal(key, "HKMetadataKeyHeartRateMotionContext");
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
