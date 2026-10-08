import Link from "next/link";
import { blogRevision } from "@/lib/blog-reload.generated";

import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { getAllPosts } from "@/lib/blog";
import { FollowProject } from "@/components/follow-project";

export const metadata = {
  title: "Blog - PulsHealth",
  description:
    "Practical guides to exporting, understanding, and using your Apple Health data, with worked examples and original analysis from PulsHealth.",
  alternates: {
    canonical: "/blog/",
    types: {
      "application/rss+xml": [{ url: "/feed.xml", title: "PulsHealth blog" }],
    },
  },
};

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function BlogPage() {
  const posts = await getAllPosts(); // newest first

  return (
    <main key={blogRevision} className="flex min-h-screen flex-col">
      <PageHero
        size="compact"
        title="The PulsHealth blog"
        lede="Export, understand, and use your Apple Health data. Practical guides, worked examples, and a closer look at what the numbers mean."
      />

      <div className="container mx-auto w-full max-w-3xl px-4 py-12 md:py-16">
        {posts.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">
            Nothing published yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {posts.map((post) => (
              <li key={post.slug} className="py-8 first:pt-0 last:pb-0">
                <article className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {post.draft ? <Badge variant="outline">Draft preview</Badge> : <time dateTime={post.date}>{formatDate(post.date)}</time>}
                    {post.updated && <span> · Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time></span>}
                    <span aria-hidden="true"> · </span>
                    {post.readingTime} min read
                  </p>
                  <h2 className="text-2xl font-semibold leading-snug tracking-tight">
                    <Link
                      href={`/blog/${post.slug}/`}
                      className="text-foreground transition-colors hover:text-brand"
                    >
                      {post.title}
                    </Link>
                  </h2>
                  <p className="leading-relaxed text-muted-foreground text-pretty">
                    {post.excerpt}
                  </p>
                  {post.tags.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 pt-1">
                      {post.tags.map((tag) => (
                        <li key={tag}>
                          <Badge variant="outline" className="font-normal text-muted-foreground">
                            {tag}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>

      <FollowProject className="mt-8" />
    </main>
  );
}
