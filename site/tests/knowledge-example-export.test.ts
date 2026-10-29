import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkKnowledgeTypePaths } from "../scripts/check-export";

test("export gate requires exact article and static-example paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "puls-example-export-"));
  const write = (route: string) => {
    const directory = path.join(root, "knowledge-base/types", route);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "index.html"), "example");
  };
  try {
    write("TypeA"); write("TypeB"); write("TypeA/example");
    assert.doesNotThrow(() => checkKnowledgeTypePaths(root, ["TypeA", "TypeB"], ["TypeA"]));
    assert.throws(() => checkKnowledgeTypePaths(root, ["TypeA", "TypeB"], ["TypeA", "TypeB"]));
    write("TypeB/unexpected");
    assert.throws(() => checkKnowledgeTypePaths(root, ["TypeA", "TypeB"], ["TypeA"]));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
