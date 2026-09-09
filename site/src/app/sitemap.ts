import type { MetadataRoute } from "next";
import { getAllTypes } from "@/lib/api";
import { getAllPosts } from "@/lib/blog";
import { STATIC_PAGES } from "@/lib/pages";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://pulshealth.com";

  // Static pages from the pages registry
  const staticEntries: MetadataRoute.Sitemap = STATIC_PAGES.map((page) => ({
    url: `${baseUrl}${page.href}`,
    changeFrequency: page.href === "/" ? "weekly" : "monthly",
    priority: page.href === "/" ? 1.0 : 0.7,
  }));

  // Knowledge base type pages
  const types = await getAllTypes();
  const typeEntries: MetadataRoute.Sitemap = types.map((type) => ({
    url: `${baseUrl}/knowledge-base/types/${type.identifier}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  // Blog posts
  const posts = await getAllPosts();
  const blogEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  // Legacy product pages not in STATIC_PAGES
  const productEntries: MetadataRoute.Sitemap = [
    "/ai",
    "/privacy-protect",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [...staticEntries, ...productEntries, ...blogEntries, ...typeEntries];
}
