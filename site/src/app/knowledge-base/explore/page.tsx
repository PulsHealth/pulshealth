import { getAllTypes } from "@/lib/api";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HealthIcon } from "@/components/health-icon";

import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: "index, follow, noai, noimageai",
  alternates: {
    canonical: '/knowledge-base/explore/',
  },
};

export default async function ExplorePage() {
  const allTypes = await getAllTypes();
  const categories = Array.from(new Set(allTypes.map(t => t.category))).sort();

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b bg-muted/30 sticky top-14 z-10 backdrop-blur-md bg-white/80 dark:bg-zinc-950/80 supports-[backdrop-filter]:bg-white/60">
        <div className="container mx-auto max-w-7xl px-4 py-4 flex items-center justify-between gap-4">
          <Link
            href="/knowledge-base"
            className="inline-flex items-center text-sm font-medium hover:text-brand transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="mr-2 h-4 w-4 shrink-0" />
            Knowledge Base
          </Link>
          <h1 className="text-lg font-semibold whitespace-nowrap">Data Type Catalog</h1>
          <div className="hidden sm:block w-[120px] shrink-0" />
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-8 space-y-16">
        {categories.map((category) => {
          const types = allTypes.filter(t => t.category === category);

          return (
            <section key={category} id={category} className="scroll-mt-32">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-1 bg-brand rounded-full" />
                <h2 className="text-2xl font-bold tracking-tight">{category}</h2>
                <Badge variant="secondary" className="ml-2">
                  {types.length}
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {types.map((t) => (
                  <Link href={`/knowledge-base/types/${t.identifier}`} key={t.identifier} className="group">
                    <Card className="h-full hover:border-brand/40 hover:shadow-md transition-all duration-200">
                      <CardHeader className="p-4 pb-2 overflow-hidden">
                        <div className="flex justify-between items-start gap-2 min-w-0">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="p-1.5 rounded-md shrink-0 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                              style={{
                                backgroundColor: t.color ? `${t.color}20` : undefined,
                                color: t.color || undefined
                              }}
                            >
                              <HealthIcon
                                iconName={t.icon}
                                category={t.category}
                                className="h-4 w-4"
                              />
                            </div>
                            <CardTitle className="text-base leading-tight group-hover:text-brand transition-colors truncate">
                              {t.human_readable_name}
                            </CardTitle>
                          </div>
                          {/* Unit badge */}
                          {t.default_unit && (
                            <Badge variant="outline" className="font-mono text-[10px] shrink-0 text-zinc-500">
                              {t.default_unit}
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="p-4 pt-2">
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {t.short_description}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
