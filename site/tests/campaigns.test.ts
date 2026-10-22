import { test } from "node:test";
import assert from "node:assert/strict";
import { campaigns } from "../src/lib/campaigns";
test("legacy campaign aliases remain registered for homepage redirects", () => {
  assert.equal(new Set(campaigns.map(item => item.id)).size, campaigns.length);
  for (const item of campaigns) {
    assert.equal(item.path, `/go/${item.id}/`);
    assert.match(item.id, /^[a-z0-9-]{1,30}$/);
  }
});
