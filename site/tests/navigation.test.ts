import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// These applications deploy separately; prevent their navbar contract drifting.
test("site and dashboard ship identical navbar geometry", () => {
  assert.equal(
    readFileSync(new URL("../src/components/navigation.css", import.meta.url), "utf8"),
    readFileSync(new URL("../../web/components/navigation.css", import.meta.url), "utf8"),
  );
});
