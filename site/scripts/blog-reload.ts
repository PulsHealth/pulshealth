import fs from "node:fs";
import path from "node:path";

/** A generated import lets Next watch edits to content outside site/. */
export function refreshBlog(siteDir = process.cwd()): void {
  fs.writeFileSync(path.join(siteDir, "src/lib/blog-reload.generated.ts"), `export const blogRevision = ${Date.now()};\n`);
}
