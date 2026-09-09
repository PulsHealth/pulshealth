import { getAllTypes, getTypeById } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Calendar, Database, Info, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { HealthIcon } from "@/components/health-icon";
import { ClinicalRangesTable } from "@/components/clinical-ranges-table";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    robots: "index, follow, noai, noimageai",
    alternates: {
      canonical: `/knowledge-base/types/${slug}/`,
    },
  };
}

// Generate static params for all known types at build time
export async function generateStaticParams() {
  const types = await getAllTypes();
  return types.map((t) => ({
    slug: t.identifier,
  }));
}

export default async function TypeDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getTypeById(slug);

  if (!data) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-muted/30">
        <div className="container mx-auto max-w-7xl px-4 py-10">
          <Link
            href="/knowledge-base"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Knowledge Base
          </Link>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex gap-4">
              <div
                className="p-3 rounded-2xl h-fit shrink-0 shadow-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                style={{
                  backgroundColor: data.color ? `${data.color}20` : undefined,
                  color: data.color || undefined
                }}
              >
                <HealthIcon
                  iconName={data.icon}
                  category={data.category}
                  className="h-8 w-8"
                  strokeWidth={2.5}
                />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Badge variant="outline" className="text-brand border-brand/30 bg-brand-muted dark:text-brand-light dark:border-brand/30">
                    {data.type}
                  </Badge>
                  <Badge variant="secondary">
                    {data.category}
                  </Badge>
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                  {data.human_readable_name}
                </h1>
                <p className="text-lg text-muted-foreground mt-2 max-w-2xl">
                  {data.short_description}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 text-sm text-muted-foreground bg-card border rounded-lg p-4 min-w-[200px]">
              <div className="flex justify-between">
                <span>Unit:</span>
                <span className="font-mono font-medium text-foreground">{data.default_unit || "N/A"}</span>
              </div>
              <div className="flex justify-between">
                <span>Since:</span>
                <span className="font-medium text-foreground">iOS {data.ios_introduced.version} ({data.ios_introduced.year})</span>
              </div>
              <div className="flex justify-between">
                <span>Source:</span>
                <span className="font-medium text-foreground">{data.source}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Main Content Column */}
        <div className="lg:col-span-2 space-y-8">

          {/* Clinical Ranges Section */}
          {data.clinical_ranges && data.clinical_ranges.length > 0 && (
            <ClinicalRangesTable ranges={data.clinical_ranges} />
          )}

          {/* Description Markdown */}
          <section className="prose prose-zinc max-w-none dark:prose-invert">
            <ReactMarkdown>{data.description}</ReactMarkdown>
          </section>
        </div>

        {/* Sidebar - appears after main content on mobile, in right column on desktop */}
        <aside className="space-y-6 lg:row-start-1 lg:col-start-3 min-w-0">

          {/* Metadata Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center">
                <Info className="mr-2 h-4 w-4 text-brand" />
                Technical Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1">Identifier</span>
                <code className="block bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-200 px-2 py-1 rounded-md text-xs select-all border border-zinc-200 dark:border-zinc-700 font-mono break-all">
                  {data.identifier}
                </code>
              </div>

              <Separator />

              <div>
                <span className="text-muted-foreground block mb-1">Aggregation</span>
                <span className="capitalize font-medium">{data.aggregation_type || "None"}</span>
              </div>

              <Separator />

              <div>
                <span className="text-muted-foreground block mb-1">Availability</span>
                <div className="space-y-2">
                  <div>
                    <div className="font-medium">iOS {data.ios_introduced.version} ({data.ios_introduced.year})</div>
                    {data.ios_introduced.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">
                        &quot;{data.ios_introduced.notes}&quot;
                      </p>
                    )}
                  </div>
                  {data.watchos_introduced && (
                    <div>
                      <div className="font-medium">watchOS {data.watchos_introduced.version} ({data.watchos_introduced.year})</div>
                      {data.watchos_introduced.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 italic">
                          &quot;{data.watchos_introduced.notes}&quot;
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {data.typical_range && (
                <div>
                  <span className="text-muted-foreground block mb-1">Typical Range</span>
                  <div className="font-medium">
                    {data.typical_range.min} - {data.typical_range.max} {data.typical_range.unit}
                  </div>
                  {data.typical_range.notes && (
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      &quot;{data.typical_range.notes}&quot;
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* References */}
          {data.references && data.references.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center">
                  <Database className="mr-2 h-4 w-4 text-brand" />
                  References
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.references.map((ref, i) => (
                  <div key={i} className="text-sm">
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2 hover:text-brand transition-colors"
                    >
                      <ExternalLink className="h-3 w-3 mt-1 shrink-0 opacity-50 group-hover:opacity-100" />
                      <span className="line-clamp-2">{ref.title}</span>
                    </a>
                    <Badge variant="secondary" className="mt-1 text-[10px] h-5">
                      {ref.type}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="text-xs text-muted-foreground flex items-center justify-center pt-4">
            <Calendar className="h-3 w-3 mr-1" />
            Last updated: {data.last_updated}
          </div>

        </aside>

        {/* Related Types - appears after sidebar on mobile, below main content on desktop */}
        {data.related_types && data.related_types.length > 0 && (
          <section className="lg:col-span-2 lg:row-start-2">
            <h3 className="text-xl font-semibold mb-4">Related Metrics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.related_types.map((related) => (
                <Link href={`/knowledge-base/types/${related.identifier}`} key={related.identifier}>
                  <Card className="hover:bg-muted/50 transition-colors h-full">
                    <CardHeader className="p-4">
                      <CardTitle className="text-sm font-medium flex items-center justify-between">
                        <span className="truncate pr-2">{related.identifier.replace("HKQuantityTypeIdentifier", "")}</span>
                        <ArrowRightIcon className="h-4 w-4 text-muted-foreground" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                      {related.relationship}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function ArrowRightIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}
