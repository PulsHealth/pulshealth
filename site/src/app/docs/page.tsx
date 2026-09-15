import { ArrowUpRight } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

export const metadata = {
  title: "Documentation - PulsHealth",
  description:
    "The PulsHealth documentation: setting up the self-hosted server, the Puls Sync Protocol specification, the database guide, exports, and using your health data with AI assistants.",
  alternates: {
    canonical: "/docs/",
  },
};

const docs = [
  {
    title: "Server setup and operations",
    description: "Bootstrap, configuration, exposing ingest, migrations, backups and restore, upgrades.",
    href: `${GITHUB}/blob/main/server/README.md`,
  },
  {
    title: "Puls Sync Protocol v1",
    description: "The wire format the app speaks: line types, JSON Schemas, canonical units, idempotency and retry rules, and how to write a receiver.",
    href: `${GITHUB}/blob/main/docs/protocol/README.md`,
  },
  {
    title: "Database guide",
    description: "Tables, views and query patterns, including how to avoid iPhone plus Watch double counting.",
    href: `${GITHUB}/blob/main/docs/database-guide.md`,
  },
  {
    title: "Use it with AI",
    description: "The read-only MCP server for Claude, Claude Code and Cursor, and the OpenAPI route for ChatGPT.",
    href: `${GITHUB}/blob/main/docs/ai.md`,
  },
  {
    title: "Exporting to CSV and JSONL",
    description: "The product API's streaming export endpoint and the puls-export command-line wrapper.",
    href: `${GITHUB}/blob/main/docs/export.md`,
  },
  {
    title: "Security policy",
    description: "What the project considers in scope, how to report privately, and the known limitations of a single bearer token.",
    href: `${GITHUB}/blob/main/SECURITY.md`,
  },
  {
    title: "PulsHealthSync, the Swift package",
    description: "The sync engine underneath the app, embeddable in another iOS app.",
    href: `${GITHUB}/blob/main/PulsHealthSync/README.md`,
  },
];

export default function DocsPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <PageHero
        eyebrow="Documentation"
        size="compact"
        title="The manuals"
        lede="Everything is written next to the code it describes. These are the entry points."
      />
      <section className="container mx-auto max-w-5xl px-4 py-16">
        <div className="grid gap-6 sm:grid-cols-2">
          {docs.map((doc) => (
            <a key={doc.title} href={doc.href} target="_blank" rel="noopener noreferrer" className="group">
              <Card className="h-full transition-colors hover:border-brand/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 group-hover:text-brand transition-colors">
                    {doc.title}
                    <ArrowUpRight className="h-4 w-4 opacity-60" />
                  </CardTitle>
                  <CardDescription className="text-base">{doc.description}</CardDescription>
                </CardHeader>
              </Card>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
