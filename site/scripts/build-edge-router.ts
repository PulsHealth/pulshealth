import fs from "node:fs";
import path from "node:path";
import { filesIn } from "./check-export";

export function buildEdgeRouter(out: string, template: string): string {
  const redirects: Record<string, string> = {};
  const routes: string[] = [];
  const examples: string[] = [];
  const key = (route: string) => route.replace("/knowledge-base/types/HKQuantityTypeIdentifier", "/q/").replace("/knowledge-base/types/HKCategoryTypeIdentifier", "/c/");
  for (const file of filesIn(out).filter(file => file.endsWith(`${path.sep}index.html`)).sort()) {
    const route = `/${path.relative(out, file).replace(/index\.html$/, "").split(path.sep).join("/")}`;
    const html = fs.readFileSync(file, "utf8");
    const target = /<meta\b[^>]*http-equiv="refresh"[^>]*content="0;url=([^"]+)"/i.exec(html)?.[1];
    if (target) {
      const decoded = target.replace(/&amp;/g, "&");
      if (!decoded.startsWith("/") && !decoded.startsWith("https://")) throw new Error(`Unsafe redirect in ${file}`);
      redirects[route] = decoded;
    } else if (/^\/knowledge-base\/types\/[A-Za-z0-9]+\/example\/$/.test(route)) {
      examples.push(key(route.slice(0, -8)));
    } else {
      routes.push(key(route));
    }
  }
  // Example paths share an existing article prefix. Store exact parent indices
  // instead of repeating their names; unlisted examples must remain real 404s.
  const exampleIndices = examples.map(parent => {
    const index = routes.indexOf(parent);
    if (index === -1) throw new Error(`Example has no exported parent article: ${parent}`);
    return index;
  });
  // The static sample pages add known routes. A delimited literal avoids the
  // repeated JSON array punctuation under CloudFront's hard 10 KB ceiling.
  if (routes.some(route => route.includes("|"))) throw new Error("Unsupported pipe in exported route");
  const source = template.replace("/* REDIRECTS */ {}", JSON.stringify(redirects))
    .replace("/* ROUTES */ []", `${JSON.stringify(routes.join("|"))}.split("|")`)
    .replace("/* EXAMPLES */ []", JSON.stringify(exampleIndices))
    .replace(/^\/\/[^\n]*\n/gm, "");
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
