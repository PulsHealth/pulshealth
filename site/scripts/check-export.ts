import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadPosts } from "../src/lib/blog";
import { DOCS } from "../src/lib/docs";
import type { BlogPost } from "../src/lib/types";

export function filesIn(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

function requireFile(file: string): string {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Export missing file: ${file}`);
  return fs.readFileSync(file, "utf8");
}

function sameSet(actual: string[], expected: string[], label: string): void {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label}: expected ${expected.join(", ")}; got ${actual.join(", ")}`);
  }
}

function decode(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const names: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    if (names[entity]) return names[entity];
    return String.fromCodePoint(parseInt(entity.slice(entity.startsWith("&#x") ? 3 : 2, -1), entity.startsWith("&#x") ? 16 : 10));
  });
}

/** Check generated HTML, so MDX components and Markdown reference links are covered too. */
export function checkLocalLinks(html: string, pageUrl: string, outDir: string): void {
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of markup.match(/<[a-z][^>]*>/gi) ?? []) {
    for (const attribute of tag.matchAll(/\b(href|src|srcset|content)\s*=\s*["']([^"']*)["']/gi)) {
      if (attribute[1].toLowerCase() === "content" && !/\b(?:property|name)=["'](?:og:image|twitter:image)["']/i.test(tag)) continue;
      const values = attribute[1].toLowerCase() === "srcset" ? attribute[2].split(",").map(value => value.trim().split(/\s+/)[0]) : [attribute[2]];
      for (const value of values) {
        if (!value || /^(?:mailto:|tel:|data:|javascript:)/i.test(value)) continue;
        const url = new URL(decode(value), `https://pulshealth.com${pageUrl}`);
        if (url.origin !== "https://pulshealth.com") continue;
        const pathname = decodeURIComponent(url.pathname);
        const direct = path.resolve(outDir, `.${pathname}`);
        if (!direct.startsWith(`${path.resolve(outDir)}${path.sep}`) && direct !== path.resolve(outDir)) throw new Error(`Invalid local URL: ${value}`);
        const file = fs.existsSync(direct) && fs.statSync(direct).isFile() ? direct : path.join(direct, "index.html");
        const target = requireFile(file);
        if (url.hash && file.endsWith(".html")) {
          const ids = [...target.matchAll(/\bid=["']([^"']+)["']/g)].map(match => decode(match[1]));
          if (!ids.includes(decodeURIComponent(url.hash.slice(1)))) throw new Error(`${pageUrl}: missing anchor ${value}`);
        }
      }
    }
  }
}

export function checkBlogExport(outDir: string, posts: BlogPost[]): void {
  const published = posts.filter(post => !post.draft);
  const blogDir = path.join(outDir, "blog");
  const routes = filesIn(blogDir).filter(file => file.endsWith(`${path.sep}index.html`) && file !== path.join(blogDir, "index.html"));
  sameSet(routes.map(file => path.relative(blogDir, path.dirname(file))), published.map(post => post.slug), "Blog pages");
  const feed = requireFile(path.join(outDir, "feed.xml"));
  const sitemap = requireFile(path.join(outDir, "sitemap.xml"));
  const search = JSON.parse(requireFile(path.join(outDir, "search-index.json"))) as Array<{ type: string; href: string }>;
  sameSet(search.filter(item => item.type === "blog").map(item => new URL(item.href, "https://pulshealth.com").pathname.replace(/\/$/, "")), published.map(post => `/blog/${post.slug}`), "Blog search entries");
  const feedUrls = [...feed.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<\/item>/g)].map(match => decode(match[1]));
  const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => decode(match[1])).filter(url => /^https:\/\/pulshealth\.com\/blog\/[^/]+\/$/.test(url));
  const urls = published.map(post => `https://pulshealth.com/blog/${post.slug}/`);
  sameSet(feedUrls, urls, "Blog RSS entries");
  sameSet(sitemapUrls, urls, "Blog sitemap entries");
  for (const draft of posts.filter(post => post.draft)) {
    if (fs.existsSync(path.join(blogDir, draft.slug))) throw new Error(`Draft page or images leaked into export: ${draft.slug}`);
  }
  checkLocalLinks(requireFile(path.join(blogDir, "index.html")), "/blog/", outDir);
  for (const post of published) {
    const html = requireFile(path.join(blogDir, post.slug, "index.html"));
    checkLocalLinks(html, `/blog/${post.slug}/`, outDir);
  }
  console.log(`blog: ${published.length} pages, feed/search/sitemap entries and local links checked; ${posts.length - published.length} drafts excluded`);
}

export function checkExport(siteDir = process.cwd()): void {
  const root = path.resolve(siteDir, "..");
  const outDir = path.join(siteDir, "out");
  const posts = loadPosts({ articlesDir: path.join(root, "blog/articles"), includeDrafts: true });
  checkBlogExport(outDir, posts);
  // Retain the tracked-source gate: deleting/moving sources must not shrink expectations.
  const tracked = execFileSync("git", ["ls-files", "--", "knowledge-base/**/*.yaml"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(file => file && !file.endsWith("schema.yaml"));
  for (const file of tracked) requireFile(path.join(root, file));
  const sources = filesIn(path.join(root, "knowledge-base")).filter(file => file.endsWith(".yaml") && !file.endsWith("schema.yaml"));
  const identifiers = sources.map(file => {
    const identifier = /^identifier:\s*["']?([A-Za-z0-9]+)["']?\s*$/m.exec(requireFile(file))?.[1];
    if (!identifier) throw new Error(`Missing knowledge-base identifier: ${file}`);
    const html = requireFile(path.join(outDir, "knowledge-base/types", identifier, "index.html"));
    if (!html.includes('href="/docs/recording-behavior/"')) {
      throw new Error(`Recording guide link missing from ${identifier}`);
    }
    if (/^recording_behavior:/m.test(requireFile(file)) &&
        (!html.includes('id="recording-behavior"') || !html.includes("Recording guidance reviewed"))) {
      throw new Error(`Recording guidance missing from ${identifier}`);
    }
    return identifier;
  });
  sameSet(filesIn(path.join(outDir, "knowledge-base/types")).filter(file => file.endsWith(`${path.sep}index.html`)).map(file => path.basename(path.dirname(file))), identifiers, "Knowledge-base pages");
  const docs = filesIn(path.join(outDir, "docs")).filter(file => file.endsWith(`${path.sep}index.html`)).map(file => path.relative(path.join(outDir, "docs"), path.dirname(file))).filter(slug => slug !== "" && slug !== "self-hosting");
  sameSet(docs, DOCS.map(doc => doc.slug), "Documentation pages");
  for (const doc of DOCS) requireFile(path.join(root, doc.repoPath));
  for (const file of ["index.html", "docs/index.html", "docs/self-hosting/index.html", "openapi.json"]) requireFile(path.join(outDir, file));
  if (!requireFile(path.join(outDir, "llms.txt")).includes("https://pulshealth.com/docs/protocol/")) throw new Error("Exported llms.txt missing protocol link");
  if (!requireFile(path.join(outDir, "docs/api-reference/index.html")).includes('id="getDailyMetrics"')) throw new Error("API reference missing endpoint");
  console.log(`export: ${identifiers.length} knowledge-base pages and ${DOCS.length} documentation pages checked`);
}

if (process.argv[1]?.endsWith("check-export.ts")) checkExport();
