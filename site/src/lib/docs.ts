import fs from "fs";
import path from "path";
import { DocPage } from "./types";

// The repository's project documentation, rendered at /docs/<slug>/. This is
// the site's third content source next to knowledge-base/ (api.ts) and blog/
// (blog.ts), and like those it reads the files by relative path from the
// repository root, so site/ has to stay where it is.
//
// The manifest is explicit and ordered rather than a directory glob: the
// export count is then deterministic and the CI count check (site job in
// .github/workflows/ci.yml) can assert it against DOCS.length. Adding a page
// means adding an entry here and bumping that number. The markdown files
// themselves are the source of truth and are never edited for the site.

export const GITHUB_REPO = "https://github.com/PulsHealth/pulshealth";

const REPO_ROOT = path.join(process.cwd(), "..");

export interface DocEntry {
  /** Route segment under /docs/. */
  slug: string;
  /** Path of the markdown file, relative to the repository root. */
  source: string;
  title: string;
  description: string;
}

export const DOCS: readonly DocEntry[] = [
  {
    slug: "protocol",
    source: "docs/protocol/README.md",
    title: "Puls Sync Protocol v1",
    description:
      "The wire protocol the app speaks, written for anyone implementing a receiver: transport, the NDJSON batch, every line type, canonical units, idempotency and the retry contract.",
  },
  {
    slug: "self-hosting",
    source: "server/README.md",
    title: "Self-hosting the reference server",
    description:
      "Running the Docker Compose stack: services and ports, configuration, schema migrations, tokens, exposing ingest, backups and the product API.",
  },
  {
    slug: "ai",
    source: "docs/ai.md",
    title: "Use it with AI assistants",
    description:
      "Connecting Claude Desktop, Claude Code, Cursor or a ChatGPT Action to your own data through the read-only MCP server, and what each tool answers.",
  },
  {
    slug: "export",
    source: "docs/export.md",
    title: "Bulk export",
    description:
      "Pulling a whole range of one dataset as streamed CSV or JSONL over GET /v1/export, with curl or the puls-export CLI.",
  },
  {
    slug: "database",
    source: "docs/database-guide.md",
    title: "Data and schema guide",
    description:
      "What the database stores and how to query it without misreading the health data: every table family, the derived views, and the device double-counting trap.",
  },
];

export function getDocEntry(slug: string): DocEntry | undefined {
  return DOCS.find((d) => d.slug === slug);
}

export async function getAllDocs(): Promise<DocPage[]> {
  const pages: DocPage[] = [];

  for (const entry of DOCS) {
    const filePath = path.join(REPO_ROOT, entry.source);
    try {
      if (!fs.existsSync(filePath)) {
        console.error(`Doc not found: ${filePath}`);
        continue;
      }
      const content = fs.readFileSync(filePath, "utf8");
      pages.push({ ...entry, content: stripLeadingTitle(content) });
    } catch (error) {
      console.error(`Error reading doc ${filePath}`, error);
    }
  }

  return pages;
}

export async function getDocBySlug(slug: string): Promise<DocPage | undefined> {
  const all = await getAllDocs();
  return all.find((d) => d.slug === slug);
}

// Every file starts with a level-one heading that the page renders as its
// title, so drop it from the body rather than showing it twice.
function stripLeadingTitle(markdown: string): string {
  return markdown.replace(/^# [^\n]*\n+/, "");
}

/** The file on GitHub at main, for a "view source" link. */
export function githubBlobUrl(repoPath: string): string {
  return `${GITHUB_REPO}/blob/main/${repoPath}`;
}

export interface ResolvedLink {
  href: string;
  external: boolean;
}

/**
 * Rewrite a link as it appears in one of the manifest's markdown files so
 * that it works from the rendered page.
 *
 * - `#fragment` and absolute URLs are returned untouched.
 * - A relative link to another manifest file becomes that file's site route
 *   (fragment preserved): `export.md` from docs/ai.md → `/docs/export/`.
 * - Any other relative link resolves against the repository root and points
 *   at GitHub: `schema/` from docs/protocol/README.md →
 *   `https://github.com/PulsHealth/pulshealth/tree/main/docs/protocol/schema/`,
 *   `../../server/ingest/parse.go` → `.../blob/main/server/ingest/parse.go`.
 *   Directories (a trailing slash) use `tree/`, files use `blob/`.
 */
export function resolveDocLink(href: string, fromSource: string): ResolvedLink {
  if (href.startsWith("#")) {
    return { href, external: false };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return { href, external: true };
  }

  const hashIndex = href.indexOf("#");
  const fragment = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const target = hashIndex >= 0 ? href.slice(0, hashIndex) : href;

  if (target === "") {
    return { href: fragment, external: false };
  }

  const isDirectory = target.endsWith("/");
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromSource), target)
  );
  const repoPath = resolved.replace(/\/+$/, "");

  const entry = DOCS.find((d) => d.source === repoPath);
  if (entry) {
    return { href: `/docs/${entry.slug}/${fragment}`, external: false };
  }

  const kind = isDirectory ? "tree" : "blob";
  return {
    href: `${GITHUB_REPO}/${kind}/main/${repoPath}${isDirectory ? "/" : ""}${fragment}`,
    external: true,
  };
}
