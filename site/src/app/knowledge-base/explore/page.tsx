import { getAllTypes } from "@/lib/api";
import Link from "next/link";
import { HealthIcon } from "@/components/health-icon";
import { PageHero } from "@/components/page-hero";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "All Apple Health Data Types - HealthKit Knowledge Base",
  description: "Every HealthKit data type, grouped by category, with its unit and a one-line description.",
  robots: "index, follow, noai, noimageai",
  alternates: {
    canonical: '/knowledge-base/explore/',
  },
};

/** "HKQuantityType" → "Quantity": shown where a type has no unit. */
function kindLabel(type: string) {
  return type.replace(/^HK/, "").replace(/Type$/, "");
}

export default async function ExplorePage() {
  const allTypes = await getAllTypes();
  const categories = Array.from(new Set(allTypes.map((t) => t.category))).sort();

  return (
    <main className="min-h-screen pb-20">
      <PageHero
        size="compact"
        eyebrow={<Link href="/knowledge-base" className="hover:text-brand">Knowledge Base</Link>}
        title={<>All {allTypes.length} <span className="text-brand">data types</span></>}
        lede="Every Apple Health type, grouped the way Apple Health groups them."
      />

      {/* Jump to a category; sticks under the site header. */}
      <nav aria-label="Categories" className="sticky top-14 z-10 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <ul className="container mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
          {categories.map((category) => (
            <li key={category} className="shrink-0">
              <a
                href={`#${category}`}
                className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
              >
                {category}
                <span className="tabular-nums text-xs text-muted-foreground/70">
                  {allTypes.filter((t) => t.category === category).length}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="container mx-auto max-w-6xl space-y-12 px-4 pt-10">
        {categories.map((category) => {
          const types = allTypes.filter((t) => t.category === category);

          return (
            <section key={category} id={category} className="scroll-mt-32">
              <h2 className="mb-3 flex items-baseline gap-2 text-xl font-semibold tracking-tight">
                {category}
                <span className="text-sm font-normal tabular-nums text-muted-foreground">{types.length}</span>
              </h2>

              <ul className="grid grid-cols-1 gap-1 rounded-xl border bg-card p-1.5 md:grid-cols-2">
                {types.map((t) => (
                  <li key={t.identifier} className="min-w-0">
                    <Link
                      href={`/knowledge-base/types/${t.identifier}`}
                      className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted"
                    >
                      <span
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                        style={{
                          backgroundColor: t.color ? `${t.color}1f` : undefined,
                          color: t.color || undefined,
                        }}
                      >
                        <HealthIcon iconName={t.icon} category={t.category} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-medium leading-snug transition-colors group-hover:text-brand">
                            {t.human_readable_name}
                          </span>
                          {t.default_unit ? (
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{t.default_unit}</span>
                          ) : (
                            <span className="shrink-0 text-[11px] text-muted-foreground">{kindLabel(t.type)}</span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {t.short_description}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
