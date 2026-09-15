import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

import { DocsNav } from "@/components/docs-nav";
import { docHref, docRoutes, getAllDocs, getDoc } from "@/lib/docs";
import { RepoMarkdown, readRepoFile, slugify, stripLeadingH1 } from "@/lib/markdown";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllDocs().map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return { title: "Document not found" };
  return {
    title: `${doc.title} - PulsHealth Docs`,
    description: doc.description,
    alternates: { canonical: docHref(doc.slug) },
  };
}

interface TocEntry {
  id: string;
  text: string;
}

/**
 * The H2 headings of a document, for "On this page". Ids match what the
 * renderer assigns (`slugify` over the heading's text), so link syntax and
 * inline code have to be reduced to their text the same way first. Lines
 * inside a fenced block are skipped: a `## comment` in a shell example is
 * not a section.
 */
function tableOfContents(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const text = match[1].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "");
    entries.push({ id: slugify(text), text });
  }
  return entries;
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  const raw = readRepoFile(doc.repoPath);
  if (!raw) notFound();

  const { body } = stripLeadingH1(raw);
  const toc = tableOfContents(body);

  return (
    <main className="min-h-screen bg-background pb-20">
      <div className="container mx-auto max-w-7xl px-4 py-10 lg:py-14">
        <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[13.5rem_minmax(0,1fr)_12rem]">
          <aside className="hidden lg:block">
            <div className="custom-scrollbar sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
              <Link
                href="/docs"
                className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                All documentation
              </Link>
              <DocsNav current={doc.slug} />
            </div>
          </aside>

          <article className="min-w-0">
            <details className="mb-8 rounded-lg border bg-muted/30 lg:hidden">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">All docs</summary>
              <div className="border-t px-4 py-4">
                <DocsNav current={doc.slug} />
              </div>
            </details>

            <header className="mb-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">{doc.group}</p>
              <h1 className="text-4xl font-bold tracking-tight text-balance">{doc.title}</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Source:{" "}
                <a
                  href={`${GITHUB}/blob/main/${doc.repoPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-mono text-foreground/80 hover:text-brand"
                >
                  {doc.repoPath}
                  <ArrowUpRight className="h-3 w-3" />
                </a>{" "}
                on GitHub ·{" "}
                <a
                  href={`${GITHUB}/edit/main/${doc.repoPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand"
                >
                  edit this page
                </a>
              </p>
            </header>

            <div className="docs-prose prose prose-zinc dark:prose-invert max-w-none prose-a:text-brand prose-a:no-underline hover:prose-a:underline prose-headings:scroll-mt-24">
              <RepoMarkdown source={body} docRepoPath={doc.repoPath} routes={docRoutes} />
            </div>
          </article>

          <aside className="hidden xl:block">
            {toc.length > 0 && (
              <nav
                aria-label="On this page"
                className="custom-scrollbar sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto border-l pl-4 text-sm"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this page</p>
                <ul className="space-y-1.5">
                  {toc.map((entry) => (
                    <li key={entry.id}>
                      <a
                        href={`#${entry.id}`}
                        className="block leading-snug text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {entry.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
