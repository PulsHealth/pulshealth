import { getAllTypes, getTypeById } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Calendar, Database, Info, ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { HealthIcon } from "@/components/health-icon";
import { ClinicalRangesTable } from "@/components/clinical-ranges-table";
import { PageHero } from "@/components/page-hero";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getTypeById(slug);
  if (!data) notFound();

  return {
    title: `${data.human_readable_name} - Apple HealthKit - PulsHealth`,
    description: data.short_description,
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

  const names = new Map((await getAllTypes()).map((t) => [t.identifier, t.human_readable_name]));
  const facts = [
    { label: "Unit", value: data.default_unit || "None", mono: Boolean(data.default_unit) },
    { label: "Since", value: `iOS ${data.ios_introduced.version} (${data.ios_introduced.year})` },
    { label: "Kind", value: data.type.replace(/^HK/, "").replace(/Type$/, "") },
  ];

  return (
    <div className="min-h-screen bg-background">
      <PageHero
        size="compact"
        eyebrow={
          <>
            <Link href="/knowledge-base" className="hover:text-brand">Knowledge Base</Link>
            <span className="mx-1.5 text-muted-foreground" aria-hidden>/</span>
            {data.category}
          </>
        }
        title={
          <>
            <span
              aria-hidden
              className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-sm"
              style={{
                backgroundColor: data.color ? `${data.color}20` : undefined,
                color: data.color || undefined,
              }}
            >
              <HealthIcon iconName={data.icon} category={data.category} className="h-7 w-7" strokeWidth={2.5} />
            </span>
            {data.human_readable_name}
          </>
        }
        lede={data.short_description}
      >
        <ul className="flex flex-wrap justify-center gap-2 text-sm">
          {facts.map((fact) => (
            <li key={fact.label} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1">
              <span className="text-muted-foreground">{fact.label}</span>
              <span className={fact.mono ? "font-mono font-medium" : "font-medium"}>{fact.value}</span>
            </li>
          ))}
        </ul>
      </PageHero>

      <main className="container mx-auto max-w-6xl px-4 py-12 grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Main Content Column */}
        <div className="lg:col-span-2 space-y-8 min-w-0">

          {/* Clinical Ranges Section */}
          {data.clinical_ranges && data.clinical_ranges.length > 0 && (
            <ClinicalRangesTable ranges={data.clinical_ranges} />
          )}

          {/* Description Markdown */}
          <section className="prose max-w-none dark:prose-invert">
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
                <code className="block bg-muted text-foreground px-2 py-1 rounded-md text-xs select-all border font-mono break-all">
                  {data.identifier}
                </code>
              </div>

              <Separator />

              <div>
                <span className="text-muted-foreground block mb-1">Source</span>
                <span className="font-medium">{data.source}</span>
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
                    {data.typical_range.min} to {data.typical_range.max} {data.typical_range.unit}
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
              {data.related_types.map((related) => {
                const hasPage = names.has(related.identifier);
                const card = (
                  <Card className="h-full gap-0 py-0 transition-colors hover:border-brand/40 hover:bg-muted/50">
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
                        <span>{names.get(related.identifier) ?? related.identifier.replace(/^HK\w+?TypeIdentifier/, "")}</span>
                        {hasPage && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                      {related.relationship}
                    </CardContent>
                  </Card>
                );
                // Related concepts may be workouts, metadata, or types the
                // knowledge base does not document. Keep their explanation,
                // but only make a link when a destination page exists.
                return hasPage ? (
                  <Link href={`/knowledge-base/types/${related.identifier}/`} key={related.identifier}>
                    {card}
                  </Link>
                ) : (
                  <div key={related.identifier}>{card}</div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
