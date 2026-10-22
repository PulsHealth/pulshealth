import { test } from "node:test";
import assert from "node:assert/strict";
import { campaigns, campaignStoreURL } from "../src/lib/campaigns";
test("registered landing pages carry unique matching Apple campaign tokens", () => {
  assert.equal(new Set(campaigns.map(item => item.id)).size, campaigns.length);
  for (const item of campaigns) {
    const url = new URL(campaignStoreURL(item.id));
    assert.equal(url.hostname, "apps.apple.com");
    assert.ok(url.pathname.includes("6757657354"));
    assert.equal(url.searchParams.get("ct"), item.id);
    assert.match(url.searchParams.get("pt") ?? "", /^\d+$/);
    assert.equal(item.path, `/go/${item.id}/`);
    assert.ok(item.id.length <= 30);
  }
});
test("arbitrary identifiers cannot become campaign links", () => {
  assert.throws(() => campaignStoreURL("arbitrary-person-or-query"));
});
