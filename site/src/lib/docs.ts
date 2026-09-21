import type { RouteMap } from "@/lib/markdown";

/**
 * The documents the site renders on-site under `/docs/<slug>/`, from their
 * one source in the repository. Everything here is read by
 * `src/lib/markdown.tsx` at build time; a document that is not in this list
 * is still reachable, but as a link to GitHub, which is what
 * `resolveRepoLink` falls back to when a relative link lands on a file that
 * has no route here.
 *
 * This file must stay free of Node imports: `src/lib/pages.ts` pulls the
 * registry into the client-side search index.
 */

export type DocGroup = "Getting started" | "Reference" | "Project";

export interface DocEntry {
  /** Route segment: `/docs/<slug>/`. */
  slug: string;
  title: string;
  /** Repo-relative path of the Markdown source. */
  repoPath: string;
  /** One sentence, for the index card, the search entry and the meta description. */
  description: string;
  group: DocGroup;
}

export const DOC_GROUPS: DocGroup[] = ["Getting started", "Reference", "Project"];

export const DOCS: DocEntry[] = [
  {
    slug: "server",
    title: "Server setup and operations",
    repoPath: "server/README.md",
    description:
      "The Docker Compose stack: bootstrap, configuration, exposing ingest, schema migrations, backups and restore, and upgrading the published images.",
    group: "Getting started",
  },
  {
    slug: "protocol",
    title: "Puls Sync Protocol v1",
    repoPath: "docs/protocol/README.md",
    description:
      "The wire format the app speaks, written for anyone implementing a receiver: line types, JSON Schemas, canonical units, idempotency and the retry contract.",
    group: "Reference",
  },
  {
    slug: "database",
    title: "Database guide",
    repoPath: "docs/database-guide.md",
    description:
      "What the database stores, how the schema is shaped, and how to query it without misreading the health data, including iPhone plus Watch double counting.",
    group: "Reference",
  },
  {
    slug: "export",
    title: "Bulk export",
    repoPath: "docs/export.md",
    description:
      "The product API's streaming export endpoint, CSV for a spreadsheet or JSONL for a notebook, and the puls-export command-line client for it.",
    group: "Reference",
  },
  {
    slug: "ai",
    title: "Use it with AI",
    repoPath: "docs/ai.md",
    description:
      "Client-side setup for asking Claude Desktop, Claude Code, Cursor or ChatGPT about your data through the read-only MCP server and the OpenAPI route.",
    group: "Reference",
  },
  {
    slug: "mcp",
    title: "MCP server",
    repoPath: "server/mcp/README.md",
    description:
      "The Go MCP server that gives AI assistants read-only tools over the product API: the tools, the stdio and HTTP transports, and how to run it.",
    group: "Reference",
  },
  {
    slug: "web-viewer",
    title: "Web viewer",
    repoPath: "web/README.md",
    description:
      "The self-hosted Next.js viewer that reads your Postgres directly: quick start, connecting to real data, the optional login and the container image.",
    group: "Reference",
  },
  {
    slug: "swift-package",
    title: "PulsHealthSync Swift package",
    repoPath: "PulsHealthSync/README.md",
    description:
      "The dependency-free Swift package underneath the app: the sync engine, transport and NDJSON encoding, embeddable in another iOS app.",
    group: "Reference",
  },
  {
    slug: "security",
    title: "Security policy",
    repoPath: "SECURITY.md",
    description:
      "Supported versions, how to report a vulnerability privately, and the known limitations of a single shared bearer token.",
    group: "Project",
  },
  {
    slug: "changelog",
    title: "Changelog",
    repoPath: "CHANGELOG.md",
    description:
      "What changed in each release of the server stack, the four images that share one version selected by PULS_VERSION.",
    group: "Project",
  },
  {
    slug: "roadmap",
    title: "Roadmap",
    repoPath: "docs/roadmap.md",
    description:
      "What is still outstanding, in the order worth doing it, tied to the requirement IDs of the open-source plan.",
    group: "Project",
  },
];

export function docHref(slug: string): string {
  return `/docs/${slug}/`;
}

/** Repo-relative path → site route, for `resolveRepoLink`. */
export const docRoutes: RouteMap = Object.fromEntries(DOCS.map((doc) => [doc.repoPath, docHref(doc.slug)]));

export function getDoc(slug: string): DocEntry | undefined {
  return DOCS.find((doc) => doc.slug === slug);
}

export function getAllDocs(): DocEntry[] {
  return DOCS;
}

export function getDocsByGroup(): Array<{ group: DocGroup; docs: DocEntry[] }> {
  return DOC_GROUPS.map((group) => ({ group, docs: DOCS.filter((doc) => doc.group === group) })).filter(
    ({ docs }) => docs.length > 0,
  );
}
