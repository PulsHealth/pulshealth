import { getAllTypes } from "@/lib/api";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HealthIcon } from "@/components/health-icon";
import { KnowledgeBaseSearch } from "@/components/knowledge-base-search";
import { PageHero } from "@/components/page-hero";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "HealthKit Knowledge Base - 178 Apple Health Data Types",
  description: "The missing manual for Apple Health data: all 178 HealthKit data types, with what each one measures, how often it is sampled, typical and clinical ranges, and how devices compare.",
  robots: "index, follow, noai, noimageai",
  openGraph: {
    title: "HealthKit Knowledge Base - 178 Apple Health Data Types",
    description: "The missing manual for Apple Health data: all 178 HealthKit data types, with clinical ranges, sampling rates and device notes.",
    images: [{ url: '/og-default.png', width: 1200, height: 600 }],
  },
  alternates: {
    canonical: '/knowledge-base/',
  },
};

const popularTypes = [
  "HKQuantityTypeIdentifierHeartRate",
  "HKQuantityTypeIdentifierBloodGlucose",
  "HKQuantityTypeIdentifierStepCount",
];

export default async function KnowledgeBasePage() {
  const allTypes = await getAllTypes();
  const categories = Array.from(new Set(allTypes.map((t) => t.category))).sort();
  const featured = popularTypes
    .map((id) => allTypes.find((t) => t.identifier === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  return (
    <main className="flex min-h-screen flex-col">
      <PageHero
        title={<>The missing manual for <span className="text-brand">Apple Health</span> data</>}
        lede={`All ${allTypes.length} HealthKit data types explained: what each one measures, how often it is sampled, typical ranges, and how devices compare.`}
        note={
          <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span>Popular:</span>
            {featured.map((f) => (
              <Link
                key={f.identifier}
                href={`/knowledge-base/types/${f.identifier}`}
                className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-brand"
              >
                {f.human_readable_name}
              </Link>
            ))}
          </span>
        }
      >
        {/* PageHero lays its buttons out by content width, so the search gets an explicit one. */}
        <KnowledgeBaseSearch className="w-[min(40rem,calc(100vw-2rem))]" />
      </PageHero>

      <section className="container mx-auto max-w-6xl px-4 py-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight">Browse by category</h2>
          <Link href="/knowledge-base/explore" className="inline-flex items-center text-sm font-medium text-brand underline-offset-4 hover:underline">
            All {allTypes.length} types
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => {
            const typesInCategory = allTypes.filter((t) => t.category === category);
            // A representative colour and icon for the category, from its types.
            const representative = typesInCategory.find((t) => t.icon && t.color) || typesInCategory[0];

            return (
              <li key={category}>
                <Link
                  href={`/knowledge-base/explore#${category}`}
                  className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-all hover:border-brand/40 hover:shadow-sm"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                    style={{
                      backgroundColor: representative?.color ? `${representative.color}1f` : undefined,
                      color: representative?.color || undefined,
                    }}
                  >
                    <HealthIcon iconName={representative?.icon} category={category} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1 font-medium transition-colors group-hover:text-brand">{category}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{typesInCategory.length}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
