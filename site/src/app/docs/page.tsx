import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Bot, Database, FileCode2, HardDriveDownload, Server } from "lucide-react";
import { GitHubIcon } from "@/components/brand-icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAllDocs, GITHUB_REPO } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Documentation | PulsHealth",
  description:
    "The Puls Sync Protocol specification, the self-hosting guide, the AI assistant setup, bulk export and the database guide — rendered from the repository.",
  alternates: {
    canonical: "/docs/",
  },
};

const ICONS = {
  protocol: FileCode2,
  "self-hosting": Server,
  ai: Bot,
  export: HardDriveDownload,
  database: Database,
} as const;

export default async function DocsPage() {
  const docs = await getAllDocs();

  return (
    <main className="flex min-h-screen flex-col items-center relative">
      {/* Hero Section */}
      <div className="w-full bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900 pt-20 pb-16 border-b">
        <div className="container mx-auto max-w-7xl px-4 flex flex-col items-center text-center space-y-6">
          <Badge variant="outline" className="px-4 py-1 text-sm rounded-full border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
            Documentation
          </Badge>

          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 max-w-3xl">
            The protocol, the server, <span className="text-brand">the data</span>
          </h1>

          <p className="text-lg text-zinc-500 max-w-2xl leading-relaxed">
            These pages are rendered from the markdown in the repository at build time, so they
            describe the code as it is on <code className="text-base">main</code>. Every page links
            back to its source file.
          </p>
        </div>
      </div>

      {/* Docs Grid */}
      <div className="container mx-auto max-w-7xl px-4 py-16">
        {docs.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-500">
              No documentation was found at build time. It lives in the repository:{" "}
              <a href={GITHUB_REPO} className="text-brand hover:underline">
                {GITHUB_REPO}
              </a>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {docs.map((doc) => {
              const Icon = ICONS[doc.slug as keyof typeof ICONS] ?? FileCode2;
              return (
                <Link key={doc.slug} href={`/docs/${doc.slug}`} className="group">
                  <Card className="h-full transition-all duration-200 hover:border-brand/30 hover:shadow-lg flex flex-col">
                    <CardHeader className="flex-1">
                      <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mb-2">
                        <Icon className="h-6 w-6" />
                      </div>
                      <CardTitle className="text-xl leading-snug group-hover:text-brand transition-colors">
                        {doc.title}
                      </CardTitle>
                      <CardDescription className="mt-2">{doc.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-xs font-mono text-muted-foreground mb-4 truncate">{doc.source}</p>
                      <div className="text-sm text-brand flex items-center font-medium opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-[-10px] group-hover:translate-x-0">
                        Read <ArrowRight className="ml-1 h-4 w-4" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-16 rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground max-w-3xl mx-auto">
          <p>
            Not everything is rendered here. The JSON Schemas, the fixture corpus, the type
            catalog, the Swift package and the MCP server each have their own README next to the
            code.{" "}
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-brand hover:underline"
            >
              <GitHubIcon className="h-3.5 w-3.5" />
              Browse the repository
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
