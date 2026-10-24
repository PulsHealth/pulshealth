import path from "node:path";

const SITE_URL = "https://pulshealth.com";
const GITHUB_BLOB = "https://github.com/PulsHealth/pulshealth/blob/main";

/** Make source links usable without a Git checkout, preserving executable examples. */
export function renderMachineMarkdown(markdown: string, repoPath: string, routes: Record<string, string>): string {
  function resolve(href: string): string {
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href)) return href;
    if (href.startsWith("/")) return new URL(href, SITE_URL).href;
    const [file, hash] = href.split("#");
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(repoPath), file));
    const target = routes[resolved] ? `${SITE_URL}${routes[resolved]}` : `${GITHUB_BLOB}/${resolved}`;
    return hash ? `${target}#${hash}` : target;
  }

  let fence: { marker: string; length: number } | undefined;
  return markdown.split("\n").map(line => {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[0], length: delimiter.length };
      else if (delimiter[0] === fence.marker && delimiter.length >= fence.length) fence = undefined;
      return line;
    }
    if (fence) return line;
    // Keep inline code literal too; links inside code are examples, not navigation.
    return line.split(/(`+[^`]*`+)/g).map(part => part.startsWith("`") ? part : part
      .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => `[${label}](${resolve(href)})`)
      .replace(/^(\s*\[[^\]]+\]:\s*)(\S+)/, (_match, prefix: string, href: string) => `${prefix}${resolve(href)}`)
    ).join("");
  }).join("\n");
}
