import { Fragment } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Dumbbell,
  Ear,
  Footprints,
  Heart,
  Moon,
  Scale,
  Utensils,
  Wind,
} from "lucide-react";

import { PageHero } from "@/components/page-hero";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCatalog, getCatalogByGroup } from "@/lib/catalog";
import { docHref, getDocLinksByGroup } from "@/lib/docs";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

export const metadata = {
  title: "Documentation - PulsHealth",
  description:
    "The PulsHealth documentation: self-hosting the database, the Puls Sync Protocol specification, the database guide, the product API and its reference, exports, using your health data with AI assistants, and every type the app syncs.",
  alternates: {
    canonical: "/docs/",
  },
};

const groupLedes: Record<string, string> = {
  "Getting started": "Get the app, choose where your data lives, and connect your AI.",
  Reference: "The wire format, the database, the APIs and the pieces around them.",
  Project: "How the project is run: reporting problems, what shipped, what is next.",
};

const categoryIcons: Record<string, typeof Activity> = {
  activity: Footprints,
  heart: Heart,
  body: Scale,
  respiratory: Wind,
  sleep: Moon,
  nutrition: Utensils,
  vitals: Activity,
  workouts: Dumbbell,
  other: Ear,
};

const textLink = "inline-flex items-center gap-1 font-medium text-brand underline-offset-4 hover:underline";

/** Every type the app syncs, from the protocol's catalog. Moved here from the old app page. */
function WhatTheAppSyncs() {
  const categories = getCatalogByGroup();
  const typeCount = getCatalog().types.length;

  return (
    <div id="what-the-app-syncs" className="mb-14 scroll-mt-20">
      <h2 className="text-2xl font-bold tracking-tight">What the app syncs</h2>
      <p className="mt-1 mb-6 max-w-3xl text-muted-foreground">
        {typeCount} Apple Health types, grouped the way Apple Health groups them. Nothing is read
        until you turn a type on and iOS grants permission. Workouts carry their GPS routes and
        per-second sensor series; ECGs bring their microvolt trace; State of Mind, sleep apnea
        events and medication doses come across on the iOS versions that support them.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {categories.map(({ group: category, types }) => {
          const Icon = categoryIcons[category.key] ?? Activity;
          return (
            <div key={category.key} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <Icon className="h-5 w-5 shrink-0 text-brand" aria-hidden />
                <span className="truncate text-sm font-medium">{category.label}</span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">{types.length}</span>
            </div>
          );
        })}
      </div>

      <details className="group mt-4 rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium">
          <span>Every type, by name</span>
          <span className="font-mono text-xs text-muted-foreground group-open:hidden">show {typeCount}</span>
          <span className="hidden font-mono text-xs text-muted-foreground group-open:inline">hide</span>
        </summary>
        <div className="grid gap-6 border-t px-5 py-5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map(({ group: category, types }) => (
            <div key={category.key}>
              <h3 className="mb-2 text-sm font-semibold">{category.label}</h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {types.map((t) => (
                  <li key={t.identifier} className="flex items-baseline justify-between gap-2">
                    <span>{t.displayName}</span>
                    {t.unit && <span className="font-mono text-xs opacity-70">{t.unit}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Rendered at build time from the protocol&apos;s published vocabulary,{" "}
          <a
            href={`${GITHUB}/blob/main/docs/protocol/catalog.json`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            catalog.json
          </a>
          . Units are the canonical ones every sample is converted to before upload.
        </p>
      </details>

      <ul className="mt-5 flex flex-col gap-x-8 gap-y-2 text-sm sm:flex-row sm:flex-wrap">
        <li>
          <Link href={`${docHref("swift-package")}#how-a-sync-runs`} className={textLink}>
            How a sync runs <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </li>
        <li>
          <Link href={docHref("protocol")} className={textLink}>
            The wire format <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </li>
        <li>
          <Link href="/knowledge-base" className={textLink}>
            What each type measures <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </li>
      </ul>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <PageHero
        eyebrow="Documentation"
        size="compact"
        title="The manuals"
        lede="Everything is written next to the code it describes and rendered here from the same files, so the page you read is the file in the repository."
      />
      <section className="container mx-auto max-w-5xl px-4 py-16">
        {getDocLinksByGroup().map(({ group, links }) => (
          <Fragment key={group}>
            <div className="mb-14">
              <h2 className="text-2xl font-bold tracking-tight">{group}</h2>
              {groupLedes[group] && <p className="mt-1 mb-6 text-muted-foreground">{groupLedes[group]}</p>}
              <div className="grid gap-6 sm:grid-cols-2">
                {links.map((link) => (
                  <Link key={link.key} href={link.href} className="group">
                    <Card className="h-full transition-colors hover:border-brand/40">
                      <CardHeader>
                        <CardTitle className="transition-colors group-hover:text-brand">{link.title}</CardTitle>
                        <CardDescription className="text-base">{link.description}</CardDescription>
                        {link.repoPath ? (
                          <p className="pt-1 font-mono text-xs text-muted-foreground">{link.repoPath}</p>
                        ) : (
                          <p className="pt-1 text-xs font-medium text-brand">{link.label}</p>
                        )}
                      </CardHeader>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
            {group === "Getting started" && <WhatTheAppSyncs />}
          </Fragment>
        ))}

        <p className="border-t pt-8 text-sm text-muted-foreground">
          Looking for something not listed here? Every other document, the schemas and the code itself are in the
          repository.{" "}
          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-brand hover:underline"
          >
            Browse the repository
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </p>
      </section>
    </main>
  );
}
