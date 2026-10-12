import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkIndexableExport } from "../scripts/check-export";

const urls = ["https://pulshealth.com/", "https://pulshealth.com/example/"];
function fixture(run: (root: string, page: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "puls-discovery-"));
  fs.mkdirSync(path.join(root, "example"));
  const page = '<title>Example</title><link rel="canonical" href="https://pulshealth.com/example/"><a href="/">Home</a>';
  fs.writeFileSync(path.join(root, "index.html"), '<title>Home</title><link rel="canonical" href="https://pulshealth.com/"><a href="/example/">Example</a>');
  fs.writeFileSync(path.join(root, "example/index.html"), page);
  fs.writeFileSync(path.join(root, "sitemap.xml"), `<urlset>${urls.map(url => `<url><loc>${url}</loc></url>`).join("")}</urlset>`);
  try { run(root, page); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("public pages must remain indexable, canonical and internally linked", () => fixture(root => {
  checkIndexableExport(root, urls);
  assert.throws(() => checkIndexableExport(root, urls.slice(0, 1)), /Public sitemap entries/);
  fs.writeFileSync(path.join(root, "index.html"), '<title>Home</title><link rel="canonical" href="https://pulshealth.com/">');
  assert.throws(() => checkIndexableExport(root, urls), /no incoming public page link/);
}));

for (const [change, error] of [
  [(html: string) => html + '<meta name="robots" content="noindex,follow">', /blocks indexing/],
  [(html: string) => html + '<meta name="googlebot" content="none">', /blocks indexing/],
  [(html: string) => html + '<meta http-equiv="refresh" content="0;url=/">', /redirect in sitemap/],
  [(html: string) => html.replace('href="https://pulshealth.com/example/"', 'href="https://pulshealth.com/"'), /canonical/],
  [(html: string) => html.replace('<title>Example</title>', '<title>Home</title>'), /duplicate title/],
  [(html: string) => html + '<a href="/missing/">Broken</a>', /missing file/],
] as const) {
  test(`reject discovery regression: ${error.source}`, () => fixture((root, page) => {
    fs.writeFileSync(path.join(root, "example/index.html"), change(page));
    assert.throws(() => checkIndexableExport(root, urls), error);
  }));
}
