import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTypeById } from "@/lib/api";
import { EXAMPLE_TYPES, RECORD_EXAMPLES, exampleDashboardHref } from "@/lib/public-demo-types";
import { RecordExample } from "@/components/record-example";

export function generateStaticParams() { return [...EXAMPLE_TYPES].map(slug => ({ slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const type = await getTypeById(slug);
  if (!type || !EXAMPLE_TYPES.has(slug)) notFound();
  return {
    title: `${type.human_readable_name}: sample records | PulsHealth`,
    description: `Inspect example ${type.human_readable_name.toLowerCase()} records, their fields, source information and JSON.`,
    robots: { index: false, follow: true },
    alternates: { canonical: `/knowledge-base/types/${slug}/example/` },
  };
}

export default async function RawExamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const type = await getTypeById(slug);
  if (!type || !EXAMPLE_TYPES.has(slug)) notFound();
  const records = RECORD_EXAMPLES.samples[slug];
  return (
    <main className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <Link href={`/knowledge-base/types/${slug}/`} className="text-sm text-muted-foreground underline underline-offset-4">‹ Back</Link>
      <h1 className="sr-only">{type.human_readable_name}: sample records</h1>
      <RecordExample records={records} categories={type.category_values ?? []} dashboardHref={exampleDashboardHref(slug)!} />
    </main>
  );
}
