import fs from "node:fs";
import path from "node:path";
import { filesIn } from "./check-export";

export function buildEdgeRouter(out: string, template: string): string {
  const redirects: Record<string, string> = {};
  const routes: string[] = [];
  for (const file of filesIn(out).filter(file => file.endsWith(`${path.sep}index.html`)).sort()) {
    const route = `/${path.relative(out, file).replace(/index\.html$/, "").split(path.sep).join("/")}`;
    const html = fs.readFileSync(file, "utf8");
    const target = /<meta\b[^>]*http-equiv="refresh"[^>]*content="0;url=([^"]+)"/i.exec(html)?.[1];
    if (target) {
      const decoded = target.replace(/&amp;/g, "&");
      if (!decoded.startsWith("/") && !decoded.startsWith("https://")) throw new Error(`Unsafe redirect in ${file}`);
      redirects[route] = decoded;
    } else {
      routes.push(route.replace("/knowledge-base/types/HKQuantityTypeIdentifier", "/q/").replace("/knowledge-base/types/HKCategoryTypeIdentifier", "/c/"));
    }
  }
  const source = template.replace("/* REDIRECTS */ {}", JSON.stringify(redirects)).replace("/* ROUTES */ []", JSON.stringify(routes));
  if (Buffer.byteLength(source) > 10000) throw new Error("CloudFront router exceeds the 10 KB function limit");
  return source;
}

if (import.meta.main) {
  const out = path.resolve("out");
  const source = buildEdgeRouter(out, fs.readFileSync("edge/router.js", "utf8"));
  fs.mkdirSync(path.join(out, "_edge"), { recursive: true });
  fs.writeFileSync(path.join(out, "_edge/router.js"), source);
  console.log(`edge router: ${Buffer.byteLength(source)} bytes`);
}
