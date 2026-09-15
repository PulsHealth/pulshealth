import fs from "fs";
import path from "path";
import type { ReactNode } from "react";
import { MarkdownAsync, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypePrettyCode, { type Options as PrettyCodeOptions } from "rehype-pretty-code";

/**
 * Render a Markdown file from elsewhere in the repository as part of a page.
 *
 * The site already reads `../knowledge-base` and `../blog` by relative path;
 * this is the same arrangement for `../docs`, `../server/README.md` and the
 * like, so a document has one source and the site renders it rather than
 * restating it. Relative links inside a document resolve against its own
 * location: to another rendered document when there is one, otherwise to the
 * file on GitHub.
 */

const REPO_ROOT = path.join(process.cwd(), "..");
const GITHUB_BLOB = "https://github.com/PulsHealth/pulshealth/blob/main";

const prettyCodeOptions: PrettyCodeOptions = {
  theme: { light: "github-light", dark: "github-dark" },
  keepBackground: false,
  defaultLang: "plaintext",
};

/** Repo-relative path → site route, for documents the site renders itself. */
export type RouteMap = Record<string, string>;

export function readRepoFile(repoPath: string): string | null {
  const abs = path.join(REPO_ROOT, repoPath);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (error) {
    console.error(`Repository file not found: ${abs}`, error);
    return null;
  }
}

/** Drop a leading `# Title` line; the page supplies its own heading. */
export function stripLeadingH1(markdown: string): { title: string | null; body: string } {
  const match = markdown.match(/^\s*#\s+(.+?)\s*\n/);
  if (!match) return { title: null, body: markdown };
  return { title: match[1], body: markdown.slice(match[0].length) };
}

/** First paragraph of prose, for a meta description. */
export function firstParagraph(markdown: string): string {
  const blocks = markdown.split(/\n\s*\n/);
  for (const block of blocks) {
    const text = block.trim();
    if (!text || text.startsWith("#") || text.startsWith("|") || text.startsWith("```") || text.startsWith("- ") || text.startsWith("> ") || text.startsWith("<")) continue;
    return text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 300);
  }
  return "";
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/**
 * Resolve an href found inside `docRepoPath` (e.g. `docs/ai.md`) to something
 * the site can serve: absolute URLs and in-page anchors pass through, a
 * relative path to a rendered document becomes its route, anything else
 * becomes the GitHub blob URL for that file.
 */
export function resolveRepoLink(href: string, docRepoPath: string, routes: RouteMap): string {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  if (href.startsWith("/")) return href;
  const [file, hash] = href.split("#");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(docRepoPath), file || path.posix.basename(docRepoPath)));
  const route = routes[resolved];
  const target = route ?? `${GITHUB_BLOB}/${resolved}`;
  return hash ? `${target}#${hash}` : target;
}

function makeComponents(docRepoPath: string, routes: RouteMap): Components {
  const heading = (Tag: "h2" | "h3" | "h4") => {
    const Heading = ({ children }: { children?: ReactNode }) => {
      const id = slugify(textOf(children));
      return (
        <Tag id={id} className="group scroll-mt-24">
          {children}
          <a href={`#${id}`} className="ml-2 opacity-0 group-hover:opacity-60 no-underline font-normal" aria-label="Link to this section">#</a>
        </Tag>
      );
    };
    Heading.displayName = `Md${Tag.toUpperCase()}`;
    return Heading;
  };
  return {
    h1: heading("h2"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    a: ({ href, children }) => {
      const resolved = resolveRepoLink(href ?? "", docRepoPath, routes);
      const external = /^https?:/.test(resolved);
      return (
        <a href={resolved} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
          {children}
        </a>
      );
    },
    table: ({ children }) => (
      <div className="overflow-x-auto -mx-1 px-1">
        <table>{children}</table>
      </div>
    ),
  };
}

interface RepoMarkdownProps {
  /** Markdown source (already read, so the caller can strip the H1 or slice it). */
  source: string;
  /** Repo-relative path of the file the source came from, for link resolution. */
  docRepoPath: string;
  routes?: RouteMap;
}

export async function RepoMarkdown({ source, docRepoPath, routes = {} }: RepoMarkdownProps) {
  return (
    <MarkdownAsync
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypePrettyCode, prettyCodeOptions]]}
      components={makeComponents(docRepoPath, routes)}
    >
      {source}
    </MarkdownAsync>
  );
}
