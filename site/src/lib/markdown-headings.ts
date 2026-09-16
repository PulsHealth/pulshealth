// A rehype plugin that gives every heading a GitHub-style id and collects
// the h2/h3 outline as it goes. The ids follow github-slugger's rules
// (lowercase; drop everything but letters, digits, spaces, hyphens and
// underscores; spaces to hyphens; `-n` on a repeat) so that the anchors the
// documents already carry for GitHub — `#91-get-v1capabilities` — resolve on
// the rendered page too. No dependency: the walk over the hast tree is a few
// lines and the site already pays for enough of unified.

export interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (!node.children) return "";
  return node.children.map(textOf).join("");
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * `collect` receives each h2/h3 in document order. Pass a fresh array per
 * compile; the plugin runs once per document.
 */
export function rehypeHeadingIds(collect?: TocEntry[]) {
  return () => (tree: HastNode) => {
    const seen = new Map<string, number>();

    const visit = (node: HastNode) => {
      if (node.type === "element" && node.tagName && HEADINGS.has(node.tagName)) {
        const text = textOf(node).trim();
        const base = slugify(text);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        node.properties = { ...(node.properties ?? {}), id };

        if (collect && (node.tagName === "h2" || node.tagName === "h3")) {
          collect.push({ id, text, depth: node.tagName === "h2" ? 2 : 3 });
        }
        return;
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}
