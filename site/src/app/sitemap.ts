import { contentModified } from "@/lib/content-dates";
import type { MetadataRoute } from "next";
import { getAllTypes } from "@/lib/api";
import { getPublishedPosts } from "@/lib/blog";
import { docHref, getAllDocs } from "@/lib/docs";
import { STATIC_PAGES } from "@/lib/pages";

export const dynamic = "force-static";

/** The site exports with `trailingSlash: true`; canonicals and the sitemap must agree. */
const withSlash = (href: string) => (href.endsWith("/") ? href : `${href}/`);

function staticSources(href: string): string[] {
  const route = href.replace(/^\/|\/$/g, "");
  const sources = [`site/src/app/${route ? `${route}/` : ""}page.tsx`];
  if (route.startsWith("inspiration/")) sources.splice(0, 1, "site/src/app/inspiration/[slug]/page.tsx", "site/src/lib/examples.ts", "site/src/lib/example-data.ts", "site/src/lib/example-recorded.json", "site/src/components/examples/example-demo.tsx", "site/src/components/examples/report-visuals.tsx", "site/src/components/examples/year-review.tsx", "site/src/components/examples/marathon-review.tsx", "site/src/components/examples/route-studio.tsx", "site/src/lib/example-report.ts", "site/src/components/examples/race-performance.tsx", "site/src/components/examples/workout-analysis.tsx", "site/src/lib/route-comparisons.ts", "site/src/components/examples/run-replay.tsx");
  if (route === "friend-flex/privacy") sources.push("site/content/friend-flex/privacy-policy.md");
  if (route === "privacy") sources.push("docs/privacy-policy.md");
  if (/^watch-workout-pro\/(support|privacy)$/.test(route)) sources.push(`site/content/watchworkoutpro/${route.endsWith("/privacy") ? "privacy-policy" : "support"}.md`);
  return sources;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://pulshealth.com";

  // Static pages from the pages registry. The rendered documents are in that
  // registry too (for search); they are listed from their own registry below
  // so the two sources cannot disagree about which /docs/ pages exist.
  const staticEntries: MetadataRoute.Sitemap = STATIC_PAGES.filter((page) => !page.href.startsWith("/docs/")).map(
    (page) => ({
      url: `${baseUrl}${withSlash(page.href)}`,
      lastModified: contentModified(staticSources(page.href)),
      changeFrequency: page.href === "/" ? "weekly" : "monthly",
      priority: page.href === "/" ? 1.0 : 0.7,
    }),
  );

  // Documentation rendered from the repository
  const docEntries: MetadataRoute.Sitemap = getAllDocs().map((doc) => ({
    url: `${baseUrl}${withSlash(docHref(doc.slug))}`,
    lastModified: contentModified([doc.repoPath]),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  // Knowledge base type pages
  const types = await getAllTypes();
  const typeEntries: MetadataRoute.Sitemap = types.map((type) => ({
    url: `${baseUrl}/knowledge-base/types/${type.identifier}/`,
    lastModified: type.last_updated ? new Date(type.last_updated) : undefined,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  // Blog posts
  const posts = await getPublishedPosts();
  const blogEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}/`,
    lastModified: new Date(post.updated || post.date),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [...staticEntries, ...docEntries, ...blogEntries, ...typeEntries];
}
