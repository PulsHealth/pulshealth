import Link from "next/link";

import { PageHero } from "@/components/page-hero";
import { Badge } from "@/components/ui/badge";
import { getAllPosts } from "@/lib/blog";

export const metadata = {
  title: "Blog - PulsHealth",
  description:
    "Occasional, long-form notes from the PulsHealth project: what the health metrics mean, and the engineering of moving them around.",
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
    <main className="flex min-h-screen flex-col">
      <PageHero
        size="compact"
        eyebrow="Blog"
        title="The PulsHealth blog"
        lede="Posts about health metrics and the engineering of syncing them."
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
                    <time dateTime={post.date}>{formatDate(post.date)}</time>
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

        <p className="mt-12 border-t pt-6 text-sm text-muted-foreground">
          Subscribe with the{" "}
          <a href="/feed.xml" className="text-brand hover:underline">
            RSS feed
          </a>
          .
        </p>
      </div>
    </main>
  );
}
