import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { buildEdgeRouter } from "../scripts/build-edge-router";

test("edge redirects only known routes, preserve repeated parameters, and collapse www in one hop", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "puls-edge-test-"));
  try {
    for (const [name, html] of Object.entries({
      "index.html": "Home", "docs/database/index.html": "Database",
      "knowledge-base/types/HKQuantityTypeIdentifierStepCount/index.html": "Steps",
      "knowledge-base/types/HKQuantityTypeIdentifierStepCount/example/index.html": "Step records",
      "app/index.html": '<meta http-equiv="refresh" content="0;url=/">',
      "license/index.html": '<meta http-equiv="refresh" content="0;url=https://github.com/PulsHealth/pulshealth/blob/main/LICENSE">',
    })) {
      const file = path.join(out, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html);
    }
    const context = vm.createContext({});
    vm.runInContext(buildEdgeRouter(out, fs.readFileSync("edge/router.js", "utf8")), context);
    const request = (uri: string, host = "pulshealth.com", method = "GET") => ({ method, uri, headers: { host: { value: host } }, querystring: {} });
    const invoke = (req: ReturnType<typeof request>) => context.handler({ request: req });
    assert.equal(invoke(request("/docs/database")).headers.location.value, "https://pulshealth.com/docs/database/");
    assert.equal(invoke(request("/docs/database/index.html", "www.pulshealth.com")).headers.location.value, "https://pulshealth.com/docs/database/");
    assert.equal(invoke(request("/knowledge-base/types/HKQuantityTypeIdentifierStepCount")).statusCode, 301);
    assert.equal(invoke(request("/knowledge-base/types/HKQuantityTypeIdentifierStepCount/example")).headers.location.value, "https://pulshealth.com/knowledge-base/types/HKQuantityTypeIdentifierStepCount/example/");
    assert.equal(invoke(request("/app/", "www.pulshealth.com")).headers.location.value, "https://pulshealth.com/");
    assert.equal(invoke(request("/license")).headers.location.value, "https://github.com/PulsHealth/pulshealth/blob/main/LICENSE");
    for (const uri of ["/missing", "/knowledge-base/types/HKQuantityTypeIdentifierMissing/example", "/api/user", "/r/example", "/docs/database/", "/_next/static/file.js"]) {
      const req = request(uri); assert.equal(invoke(req), req);
    }
    const post = request("/app", "pulshealth.com", "POST"); assert.equal(invoke(post), post);
    const req = { ...request("/app"), querystring: { tag: { value: "a%20b", multiValue: [{ value: "a%20b" }, { value: "c" }] }, empty: { value: "" } } };
    assert.equal(invoke(req).headers.location.value, "https://pulshealth.com/?tag=a%20b&tag=c&empty=");
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
