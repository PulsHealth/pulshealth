import type { ReactNode } from "react";
import Link from "next/link";
import { compileMDX } from "next-mdx-remote/rsc";
import type { MDXComponents } from "mdx/types";
import remarkGfm from "remark-gfm";
import rehypePrettyCode from "rehype-pretty-code";
import type { Options } from "rehype-pretty-code";
import { mdxComponents } from "@/components/mdx-components";
import { resolveDocLink } from "@/lib/docs";
import { rehypeHeadingIds, type TocEntry } from "@/lib/markdown-headings";
import type { DocPage } from "@/lib/types";

// The blog's highlighter settings, so code looks the same on both.
const prettyCodeOptions: Options = {
  theme: "github-dark",
  keepBackground: true,
  defaultLang: "plaintext",
};

// Element overrides the blog already styles and that plain markdown produces.
// Its `a` and `img` are replaced: links need the repository-relative rewrite,
// and next/image with a fixed size is wrong for a document we do not control.
const {
  table,
  thead,
  tbody,
  tr,
  th,
  td,
  blockquote,
} = mdxComponents;

function docComponents(source: string): MDXComponents {
  return {
    table,
    thead,
    tbody,
    tr,
    th,
    td,
    blockquote,
    a: ({ href, children, ...props }) => {
      const link = resolveDocLink(href ?? "", source);
      if (link.external) {
        return (
          <a href={link.href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      }
      return (
        <Link href={link.href} {...props}>
          {children}
        </Link>
      );
    },
  };
}

export interface RenderedDoc {
  content: ReactNode;
  toc: TocEntry[];
}

/**
 * Compile one manifest document. Plain markdown (`format: "md"`), not MDX:
 * these files are written for GitHub and use `<token>`, `{base}` and the
 * like in prose, which MDX would read as JSX and expressions.
 */
export async function renderDoc(doc: DocPage): Promise<RenderedDoc> {
  const toc: TocEntry[] = [];
  const { content } = await compileMDX({
    source: doc.content,
    components: docComponents(doc.source),
    options: {
      mdxOptions: {
        format: "md",
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeHeadingIds(toc), [rehypePrettyCode, prettyCodeOptions]],
      },
    },
  });
  return { content, toc };
}

export function DocToc({ toc }: { toc: TocEntry[] }) {
  if (toc.length === 0) return null;
  return (
    <nav aria-label="On this page">
      <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        On this page
      </p>
      <ol className="space-y-1.5 text-sm border-l border-border">
        {toc.map((entry) => (
          <li key={entry.id} className={entry.depth === 3 ? "pl-6" : "pl-3"}>
            <a
              href={`#${entry.id}`}
              className="block text-muted-foreground hover:text-foreground transition-colors leading-snug"
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
