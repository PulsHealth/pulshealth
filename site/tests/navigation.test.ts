import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// These applications deploy separately; prevent their navbar contract drifting.
test("site and dashboard ship identical navbar geometry", () => {
  expect(readFileSync(new URL("../src/components/navigation.css", import.meta.url), "utf8"))
    .toBe(readFileSync(new URL("../../web/components/navigation.css", import.meta.url), "utf8"));
});
