import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PUBLIC_DEMO_TYPES, personalDashboardHref, publicDemoHref } from "../src/lib/public-demo-types";
import { getAllTypes } from "../src/lib/api";

test("public demo coverage has knowledge-base articles and supported catalog routes", async () => {
  const articles = new Set((await getAllTypes()).map(type => type.identifier));
  const catalog = JSON.parse(fs.readFileSync(new URL("../../docs/protocol/catalog.json", import.meta.url), "utf8"));
  const types = new Map<string, { kind: string }>(catalog.types.map((type: { identifier: string; kind: string }) => [type.identifier, type]));
  for (const identifier of PUBLIC_DEMO_TYPES) {
    assert.ok(articles.has(identifier), `Missing article: ${identifier}`);
    assert.ok(["quantity", "category"].includes(types.get(identifier)?.kind ?? ""), `Unsupported viewer route: ${identifier}`);
    const url = new URL(publicDemoHref(identifier)!);
    assert.equal(url.origin, "https://app.pulshealth.com");
    assert.equal(url.pathname, "/demo");
    assert.equal(url.searchParams.get("type"), identifier);
  }
});

test("unverified metrics have no example invitation; own-data sign-in keeps its destination", () => {
  assert.equal(publicDemoHref("HKQuantityTypeIdentifierBloodGlucose"), null);
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
