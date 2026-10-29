import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTypeById } from "@/lib/api";
import { EXAMPLE_TYPES, RECORD_EXAMPLES } from "@/lib/public-demo-types";
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
  const quantity = records[0].kind === "quantity";
  return (
    <main className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <Link href={`/knowledge-base/types/${slug}/`} className="text-sm text-muted-foreground underline underline-offset-4">‹ Back to {type.human_readable_name}</Link>
      <header className="mt-7 max-w-3xl">
        <h1 className="text-3xl font-medium tracking-tight md:text-4xl">{type.human_readable_name}: sample records</h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">{type.short_description}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">A fixed excerpt of recorded Apple Health data. Select a row to see its complete example JSON, including any source, device and metadata fields present.</p>
      </header>
      <RecordExample records={records} categories={type.category_values ?? []} />
      <section aria-labelledby="example-fields" className="mt-10 max-w-3xl border-t pt-8">
        <div>
          <h2 id="example-fields" className="text-lg font-medium">Fields in the JSON</h2>
          <dl className="mt-4 space-y-3 text-sm leading-relaxed">
            <div><dt className="font-mono text-xs">uuid · type · kind</dt><dd className="mt-1 text-muted-foreground">The example sample’s ID, its HealthKit identifier and whether it is a quantity or category.</dd></div>
            <div><dt className="font-mono text-xs">start · end</dt><dd className="mt-1 text-muted-foreground">The sample’s time interval. Equal timestamps represent a point in time.</dd></div>
            <div><dt className="font-mono text-xs">{quantity ? "value · unit" : "category"}</dt><dd className="mt-1 text-muted-foreground">{quantity ? "The sample value, converted to its canonical unit before upload." : "The original category code. Its label is shown alongside the code when the knowledge base defines one."}</dd></div>
            <div><dt className="font-mono text-xs">sourceName · sourceBundleID · device</dt><dd className="mt-1 text-muted-foreground">The recording source and device labels, generalized in this example.</dd></div>
            <div><dt className="font-mono text-xs">metadata</dt><dd className="mt-1 text-muted-foreground">Additional sample context, when present. Missing metadata is left absent. Database-generated keys and account information are not part of these upload objects.</dd></div>
          </dl>
          {type.metadata_keys && type.metadata_keys.length > 0 && <details className="mt-5 text-sm"><summary className="cursor-pointer font-medium">More about this type’s metadata</summary><dl className="mt-3 space-y-3">{type.metadata_keys.map(field => <div key={field.key}><dt className="break-all font-mono text-xs">{field.key}</dt><dd className="mt-1 text-muted-foreground">{field.description}</dd></div>)}</dl></details>}
        </div>
      </section>
      <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">Sources can overlap. Adding up raw samples across a phone and watch can double-count data. <Link href={`/knowledge-base/types/${slug}/`} className="text-brand underline underline-offset-4">Read the full guide</Link> for how this type is recorded and interpreted.</p>
    </main>
  );
}
