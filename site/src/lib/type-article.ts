/** Stable heading anchors shared by the article and its contents navigation. */
export function headingAnchor(title: string): string {
  return title.toLowerCase().replace(/[*_`]/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-") || "section";
}

export interface ArticleSection { title: string | null; id: string; markdown: string }

/** Split only top-level article sections, ignoring headings inside code fences. */
export function articleSections(markdown: string): ArticleSection[] {
  const sections: ArticleSection[] = [];
  let title: string | null = null;
  let lines: string[] = [];
  let fence: string | null = null;
  const used = new Map<string, number>();
  const flush = () => {
    if (!title && !lines.join("\n").trim()) return;
    const base = title ? headingAnchor(title) : "overview";
    const occurrence = (used.get(base) ?? 0) + 1;
    used.set(base, occurrence);
    sections.push({ title, id: occurrence > 1 ? `${base}-${occurrence}` : base, markdown: lines.join("\n").trim() });
  };
  for (const line of markdown.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
    }
    const heading = !fence && line.match(/^##\s+(.+?)\s*#*$/);
    if (heading) { flush(); title = heading[1]; lines = []; }
    else lines.push(line);
  }
  flush();
  return sections;
}

/** Columns that actually render; notes-only entries do not create a table. */
export function clinicalRangeDataKeys(ranges?: Array<{ [key: string]: string | undefined }> | null): string[] {
  return Array.from(new Set((ranges ?? []).flatMap((range) => Object.keys(range)))).filter(
    (key) => key !== "population" && key !== "notes" && ranges?.some((range) => range[key]),
  );
}
