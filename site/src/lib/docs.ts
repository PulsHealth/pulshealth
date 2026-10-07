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
  /** Repo-relative path of the source: Markdown, or an OpenAPI document. */
  repoPath: string;
  /**
   * How the source is rendered: Markdown (the default) or, for an OpenAPI
   * document, as an API reference (`src/components/api-reference.tsx`).
   */
  format?: "markdown" | "openapi";
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
    group: "Reference",
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
    slug: "api",
    title: "Product API",
    repoPath: "docs/api.md",
    description:
      "The read-only HTTP API over your health data: a quickstart, authentication, choosing the user, conventions, paging, errors and rate limits.",
    group: "Reference",
  },
  {
    slug: "api-reference",
    title: "API reference",
    repoPath: "server/api/openapi.json",
    format: "openapi",
    description:
      "Every product API endpoint with its parameters, responses, fields and a curl example, rendered from the OpenAPI 3.1 document the service serves.",
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
      "Connect any AI assistant that speaks MCP, such as Claude, ChatGPT, Cursor or Qwen: sign in on the PulsHealth database, or run the read-only MCP server on your own.",
    group: "Getting started",
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
      "Supported versions, how to report a vulnerability privately, the threat model, and the trust boundaries of each token.",
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

/**
 * Pages written for the site that belong to the documentation all the same:
 * listed on `/docs` and in the docs sidebar, but routed where they are, not
 * under `/docs/<slug>/`. They are deliberately not in `DOCS`, which the
 * build renders from repository files and CI counts against `out/docs/`.
 */
export interface DocGuide {
  title: string;
  href: string;
  description: string;
  group: DocGroup;
  /** The call to action under the card on `/docs`. */
  label: string;
  /** A page outside the documentation: on the `/docs` index, not in the sidebar. */
  indexOnly?: boolean;
}

/** The hosted database's sign-up page, on the viewer's origin. */
const SIGNUP_URL = "https://app.pulshealth.com/signup";

export const GUIDES: DocGuide[] = [
  {
    title: "The app",
    href: "/#how-it-works",
    description:
      "Free on the App Store. Explore and export Apple Health on your iPhone, then sync it to a database.",
    group: "Getting started",
    label: "How it works",
    indexOnly: true,
  },
  {
    title: "The PulsHealth database",
    href: SIGNUP_URL,
    description:
      "We run the database, the web viewer and the AI connection for you. Create an account and connect the app to it.",
    group: "Getting started",
    label: "Get started",
    indexOnly: true,
  },
  {
    title: "Self-hosting",
    href: "/server/",
    description:
      "Run the open-source PulsHealth database on a machine you own: one script brings it up and prints the code that pairs the app.",
    group: "Getting started",
    label: "Set it up",
  },
];

/** One entry in the docs sidebar or on the index: a rendered document or a guide. */
export interface DocLink {
  key: string;
  title: string;
  href: string;
  description: string;
  /** The source file, for a rendered document. */
  repoPath?: string;
  /** A guide's call to action. */
  label?: string;
}

/**
 * Guides first in their group, then the rendered documents in manifest order.
 * The sidebar passes `sidebar` to leave out guides that live outside the docs.
 */
export function getDocLinksByGroup({ sidebar = false }: { sidebar?: boolean } = {}): Array<{
  group: DocGroup;
  links: DocLink[];
}> {
  return DOC_GROUPS.map((group) => ({
    group,
    links: [
      ...GUIDES.filter((guide) => guide.group === group && !(sidebar && guide.indexOnly)).map((guide) => ({
        key: guide.href,
        title: guide.title,
        href: guide.href,
        description: guide.description,
        label: guide.label,
      })),
      ...DOCS.filter((doc) => doc.group === group).map((doc) => ({
        key: doc.slug,
        title: doc.title,
        href: docHref(doc.slug),
        description: doc.description,
        repoPath: doc.repoPath,
      })),
    ],
  })).filter(({ links }) => links.length > 0);
}
