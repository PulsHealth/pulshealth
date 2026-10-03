#!/usr/bin/env bun
/**
 * Publish the product API's OpenAPI document at
 * https://pulshealth.com/openapi.json, the download the API reference
 * (`/docs/api-reference/`) links to.
 *
 * The one source is `server/api/openapi.json`, which the Go service embeds
 * and serves at its own `/openapi.json` (the same arrangement as
 * `gen-llms-txt.ts`). The service fills `servers[0].url` in from the request
 * it answers; a copy served from the site cannot know anyone's deployment, so
 * it names the address the API listens on by default and says so. Generate a
 * client from your own deployment's `/openapi.json` to get its real URL.
 *
 * Runs before every dev run and build (`predev`, `prebuild` in package.json);
 * the output is gitignored. `bun scripts/gen-openapi.ts` runs it by hand.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "{{origin}}";
const DEFAULT_SERVER = {
  url: "http://127.0.0.1:8081",
  description:
    "The address the API listens on, on the server itself. Replace it with your HTTPS proxy's URL, or fetch /openapi.json from your deployment, which names it for you.",
};

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(siteDir, "..", "server", "api", "openapi.json");
const target = path.join(siteDir, "public", "openapi.json");

let document: { servers?: Array<{ url: string; description?: string }> };
try {
  document = JSON.parse(fs.readFileSync(source, "utf8"));
} catch (error) {
  console.error(`gen-openapi: could not read ${source}`, error);
  process.exit(1);
}
const servers = document.servers ?? [];
if (servers.length !== 1 || servers[0].url !== PLACEHOLDER) {
  console.error(`gen-openapi: expected exactly one server with url ${PLACEHOLDER} in ${source}`);
  process.exit(1);
}
document.servers = [DEFAULT_SERVER];
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
console.log(`gen-openapi: wrote ${path.relative(siteDir, target)}`);
