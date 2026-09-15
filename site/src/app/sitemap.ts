import type { MetadataRoute } from "next";
import { getAllTypes } from "@/lib/api";
import { getAllPosts } from "@/lib/blog";
import { docHref, getAllDocs } from "@/lib/docs";
import { STATIC_PAGES } from "@/lib/pages";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://pulshealth.com";

  // Static pages from the pages registry. The rendered documents are in that
  // registry too (for search); they are listed from their own registry below
  // so the two sources cannot disagree about which /docs/ pages exist.
  const staticEntries: MetadataRoute.Sitemap = STATIC_PAGES.filter((page) => !page.href.startsWith("/docs/")).map(
    (page) => ({
      url: `${baseUrl}${page.href}`,
      changeFrequency: page.href === "/" ? "weekly" : "monthly",
      priority: page.href === "/" ? 1.0 : 0.7,
    }),
  );

  // Documentation rendered from the repository
  const docEntries: MetadataRoute.Sitemap = getAllDocs().map((doc) => ({
    url: `${baseUrl}${docHref(doc.slug)}`,
    changeFrequency: "monthly",
    priority: 0.7,
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

  return [...staticEntries, ...docEntries, ...blogEntries, ...typeEntries];
}
