import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PREVIEW_GROUPS, previewInvite, setMetric, validDraft } from "../src/lib/group-preview";

describe("group preview consent boundaries", () => {
  test("turning one group off preserves another and cannot add unrequested data", () => {
    const first = { group: PREVIEW_GROUPS[0], enabled: [...PREVIEW_GROUPS[0].metrics] };
    const other = { group: PREVIEW_GROUPS[1], enabled: [...PREVIEW_GROUPS[1].metrics] };
    let result = first;
    for (const metric of first.group.metrics) result = setMetric(result, metric, false);
    assert.deepEqual(result.enabled, []);
    assert.deepEqual(setMetric(result, "Unrequested", true).enabled, []);
    assert.deepEqual(other.enabled, PREVIEW_GROUPS[1].metrics);
    assert.deepEqual(first.enabled, PREVIEW_GROUPS[0].metrics);
  });

  test("unknown invitation never resolves to an organizer or recipient", () => {
    assert.equal(previewInvite("https://untrusted.example.org"), undefined);
    assert.equal(previewInvite("gym")?.id, "gym");
    assert.equal(previewInvite("expired"), undefined);
  });

  test("draft needs a coherent request, dates and separate host", () => {
    const base = PREVIEW_GROUPS[0];
    assert.equal(validDraft(base), true);
    assert.equal(validDraft({ ...base, metrics: [] }), false);
    assert.equal(validDraft({ ...base, end: "2026-10-01" }), false);
    assert.equal(validDraft({ ...base, destination: "separate", host: "" }), false);
    assert.equal(validDraft({ ...base, destination: "separate", host: "https://bad.example.org/token" }), false);
    assert.equal(validDraft({ ...base, destination: "separate", host: "research.example.org" }), true);
    assert.equal(validDraft({ ...base, start: "", end: "" }), true);
  });
});
