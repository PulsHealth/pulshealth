import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { articleSections, headingAnchor, clinicalRangeDataKeys } from "../src/lib/type-article";

describe("article navigation", () => {
  test("keeps introductory prose and gives repeated headings unique anchors", () => {
    const sections = articleSections("Introduction.\n\n## Recording cadence\nFirst.\n## Recording cadence\nSecond.");
    assert.deepEqual(sections.map((section) => section.id), ["overview", "recording-cadence", "recording-cadence-2"]);
    assert.equal(sections[0].markdown, "Introduction.");
  });
  test("does not treat fenced code as an article section", () => {
    const sections = articleSections("## Data\n```markdown\n## This is code\n```\n## Limits\nText.");
    assert.deepEqual(sections.map((section) => section.title), ["Data", "Limits"]);
    assert.ok(sections[0].markdown.includes("## This is code"));
  });
  test("figure section matching shares normalized anchors", () => {
    assert.equal(headingAnchor("What does **HRV** mean?"), "what-does-hrv-mean");
  });
});

test("notes-only clinical guidance does not create a broken range-table anchor", () => {
  assert.deepEqual(clinicalRangeDataKeys([{ population: "Adults", notes: "No universal target." }]), []);
  assert.deepEqual(clinicalRangeDataKeys([{ population: "Adults", normal: "", notes: "Context only." }]), []);
  assert.deepEqual(clinicalRangeDataKeys([{ population: "Adults", normal: "Source-specific interval" }]), ["normal"]);
  assert.deepEqual(clinicalRangeDataKeys(null), []);
});
