import { test } from "node:test";
import assert from "node:assert/strict";
import robots from "../src/app/robots";

test("search and user retrieval can read knowledge pages without granting training crawlers the same access", () => {
  const rules = robots().rules;
  if (!Array.isArray(rules)) throw new Error("Expected crawler groups");
  for (const agent of ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"]) {
    const group: (typeof rules)[number] | undefined = rules.find(rule => [rule.userAgent].flat().includes(agent));
    assert.equal(group?.allow, "/"); assert.equal(group?.disallow, undefined);
  }
  for (const agent of ["GPTBot", "ClaudeBot", "Google-Extended"]) {
    assert.equal(rules.find(rule => [rule.userAgent].flat().includes(agent))?.disallow, "/knowledge-base/");
  }
});
