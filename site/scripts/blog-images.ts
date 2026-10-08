import fs from "node:fs";
import path from "node:path";
import { loadPosts } from "../src/lib/blog";
import { refreshBlog } from "./blog-reload";

/** Recreate only this generated directory; never copy orphan or draft assets to production. */
export function syncBlogImages({ siteDir = process.cwd(), includeDrafts = false } = {}): void {
  const blogDir = path.resolve(siteDir, "../blog");
  const posts = loadPosts({ articlesDir: path.join(blogDir, "articles"), includeDrafts });
  const source = path.join(blogDir, "images");
  if (!fs.existsSync(source)) throw new Error(`Blog images directory not found: ${source}`);
  const destination = path.join(siteDir, "public/blog");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const post of posts) {
    const directory = path.join(source, post.slug);
    if (fs.existsSync(directory)) fs.cpSync(directory, path.join(destination, post.slug), { recursive: true });
  }
}

if (process.argv[1]?.endsWith("blog-images.ts")) {
  syncBlogImages();
  refreshBlog();
}
