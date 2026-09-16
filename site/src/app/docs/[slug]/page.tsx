import "@/app/code-styles.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { GitHubIcon } from "@/components/brand-icons";
import { DocToc, renderDoc } from "@/components/doc-content";
import { DOCS, getDocBySlug, githubBlobUrl } from "@/lib/docs";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return DOCS.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);

  if (!doc) {
    return { title: "Page Not Found" };
  }

  const url = `https://pulshealth.com/docs/${slug}/`;
  return {
    title: `${doc.title} | PulsHealth Docs`,
    description: doc.description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "article",
      title: doc.title,
      description: doc.description,
      url,
      siteName: "PulsHealth",
    },
  };
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);

  if (!doc) {
    notFound();
  }

  const { content, toc } = await renderDoc(doc);
  const sourceUrl = githubBlobUrl(doc.source);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-muted/30">
        <div className="container mx-auto max-w-7xl px-4 py-10">
          <Link
            href="/docs"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            All documentation
          </Link>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-foreground leading-tight">
            {doc.title}
          </h1>

          <p className="mt-4 max-w-3xl text-lg text-muted-foreground">{doc.description}</p>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-brand hover:underline font-medium"
            >
              <GitHubIcon className="h-4 w-4" />
              View source on GitHub
            </a>
            <span>
              Rendered from <code className="text-xs">{doc.source}</code> at build time.
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto max-w-7xl px-4 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_16rem] gap-12">
          <details className="lg:hidden rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">On this page</summary>
            <div className="mt-4">
              <DocToc toc={toc} />
            </div>
          </details>

          <article className="min-w-0 prose prose-zinc max-w-none dark:prose-invert prose-headings:scroll-mt-20 prose-a:text-brand prose-a:no-underline hover:prose-a:underline prose-img:rounded-lg prose-code:text-[0.9em]">
            {content}
          </article>

          <aside className="hidden lg:block">
            <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
              <DocToc toc={toc} />
            </div>
          </aside>
        </div>
      </main>

      {/* Footer CTA */}
      <div className="border-t bg-muted/30">
        <div className="container mx-auto max-w-7xl px-4 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Found a gap?</h3>
              <p className="text-muted-foreground text-sm">
                This page is the repository file, rendered. Fix it there and the site follows.
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/docs"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
              >
                More Documentation
              </Link>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-brand text-white hover:bg-brand/90 h-10 px-4 py-2"
              >
                Edit on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
