import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { BlogPost } from "./types";

const ARTICLES_DIR = path.join(process.cwd(), "..", "blog", "articles");
const FIELDS = new Set(["title", "date", "updated", "draft", "author", "tags", "excerpt", "featured_image"]);

export function loadPosts({
  articlesDir = ARTICLES_DIR,
  includeDrafts = false,
  today = new Date().toISOString().slice(0, 10),
}: { articlesDir?: string; includeDrafts?: boolean; today?: string } = {}): BlogPost[] {
  if (!fs.existsSync(articlesDir)) throw new Error(`Blog articles directory not found: ${articlesDir}`);
  const slugs = new Set<string>();
  const posts: BlogPost[] = [];

  for (const file of fs.readdirSync(articlesDir).sort()) {
    if (!/\.mdx?$/.test(file)) continue;
    try {
      const slug = file.replace(/\.mdx?$/, "");
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("use a lowercase, hyphen-separated filename");
      if (slugs.has(slug)) throw new Error(`duplicate slug: ${slug}`);
      slugs.add(slug);
      const { data, content } = matter(fs.readFileSync(path.join(articlesDir, file), "utf8"));
      for (const field of Object.keys(data)) {
        if (!FIELDS.has(field)) throw new Error(`unknown metadata field: ${field}`);
      }
      if (data.draft !== undefined && typeof data.draft !== "boolean") throw new Error("draft must be true or false");
      const draft = data.draft === true;
      const string = (field: string, required = false): string => {
        const value: unknown = data[field];
        if (value === undefined && !required) return "";
        if (typeof value !== "string" || (required && !value.trim())) throw new Error(`${field} must be a${required ? " nonempty" : ""} string`);
        return value.trim();
      };
      const date = (field: string, required = false): string => {
        const value = string(field, required);
        if (!value && !required) return "";
        const parsed = new Date(`${value}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
          throw new Error(`${field} must be a real, quoted YYYY-MM-DD date`);
        }
        if (!draft && value > today) throw new Error(`${field} is in the future; keep the post as draft: true until publication`);
        return value;
      };
      const published = date("date", !draft);
      const updated = date("updated");
      if (updated && (!published || updated < published)) throw new Error("updated requires date and cannot precede it");
      const tags: unknown = data.tags ?? [];
      if (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string" || !tag.trim())) throw new Error("tags must be an array of nonempty strings");
      const featuredImage = string("featured_image");
      if (featuredImage && !/^https?:\/\//.test(featuredImage) && !/^\/(?!\/)/.test(featuredImage)) {
        throw new Error("featured_image must be an absolute HTTP(S) URL or a site-relative path");
      }
      const post: BlogPost = {
        slug, draft, title: string("title", true), date: published, updated: updated || undefined,
        author: string("author"), tags, excerpt: string("excerpt", !draft), content,
        featured_image: featuredImage || undefined,
        readingTime: Math.max(1, Math.round(content.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length / 220)),
      };
      if (!draft && !content.trim()) throw new Error("published posts need a body");
      if (includeDrafts || !draft) posts.push(post);
    } catch (error) {
      throw new Error(`${path.join(articlesDir, file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return posts.sort((a, b) => Number(b.draft) - Number(a.draft) || b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

/** Drafts are available only in the local development server. */
export async function getAllPosts(): Promise<BlogPost[]> {
  return loadPosts({ includeDrafts: process.env.NODE_ENV === "development" });
}

/** Discovery surfaces always describe published content, even in preview. */
export async function getPublishedPosts(): Promise<BlogPost[]> {
  return loadPosts();
}

export async function getPostBySlug(slug: string): Promise<BlogPost | undefined> {
  return (await getAllPosts()).find(post => post.slug === slug);
}
