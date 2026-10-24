import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { contentModified } from "../src/lib/content-dates";

test("lastmod follows committed content, never build time, uncommitted changes or shallow history", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "puls-date-test-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-02T12:00:00Z", GIT_COMMITTER_DATE: "2026-01-02T12:00:00Z" } }).trim();
  try {
    git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
    fs.writeFileSync(path.join(root, "page.md"), "Content"); git("add", "."); git("commit", "-qm", "Content");
    assert.equal(Date.parse(contentModified(["page.md"], root)!), Date.parse("2026-01-02T12:00:00Z"));
    fs.utimesSync(path.join(root, "page.md"), new Date(), new Date());
    assert.equal(Date.parse(contentModified(["page.md"], root)!), Date.parse("2026-01-02T12:00:00Z"));
    fs.writeFileSync(path.join(root, "page.md"), "Edited"); assert.equal(contentModified(["page.md"], root), undefined);
    git("checkout", "--", "page.md"); fs.writeFileSync(path.join(root, ".git/shallow"), git("rev-parse", "HEAD") + "\n");
    assert.equal(contentModified(["page.md"], root), undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
