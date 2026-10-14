import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HealthKitType } from "@/lib/types";
import { articleSections, headingAnchor, clinicalRangeDataKeys } from "@/lib/type-article";

type Figure = NonNullable<HealthKitType["figures"]>[number];

export function DataFigure({ figure }: { figure: Figure }) {
  return (
    <figure className="my-8 overflow-hidden rounded-lg border bg-card">
      <div className="bg-white p-2 sm:p-4">
        {/* Static, source-authored charts stay available without JavaScript. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={figure.src} alt={figure.alt} width={figure.width ?? 1200} height={figure.height ?? 720} loading="lazy" className="h-auto w-full" />
      </div>
      <figcaption className="space-y-2 p-5 text-sm leading-relaxed">
        <p className="font-semibold">{figure.title}</p>
        <p className="text-muted-foreground">{figure.caption}</p>
        <a href={figure.src} target="_blank" rel="noopener noreferrer" className="inline-block text-brand underline underline-offset-4">View full-size figure</a>
        {figure.methods && <details className="text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-4">How this figure was made</summary>
          <p className="mt-2">{figure.methods}</p>
        </details>}
      </figcaption>
    </figure>
  );
}

export function TypeArticle({ data }: { data: HealthKitType }) {
  const sections = articleSections(data.description);
  const matched = new Set<string>();
  return <>
    {sections.map((section, index) => {
      const figures = (data.figures ?? []).filter((figure) => figure.section && (headingAnchor(figure.section) === headingAnchor(section.title ?? "overview") || figure.section === section.id));
      figures.forEach((figure) => matched.add(figure.src));
      const remaining = index === sections.length - 1 ? (data.figures ?? []).filter((figure) => !matched.has(figure.src)) : [];
      return <section key={section.id} aria-labelledby={section.title ? section.id : undefined} className="min-w-0">
        {section.title && <h2 id={section.id} className="mb-5 scroll-mt-24 text-2xl font-semibold tracking-tight">{section.title}</h2>}
        <div className="prose prose-base max-w-none break-words leading-7 prose-headings:scroll-mt-24 prose-headings:tracking-tight prose-p:my-4 prose-li:my-1 prose-a:text-brand dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
          }}>{section.markdown}</ReactMarkdown>
        </div>
        {[...figures, ...remaining].map((figure) => <DataFigure key={figure.src} figure={figure} />)}
      </section>;
    })}
  </>;
}

export function ArticleContents({ data }: { data: HealthKitType }) {
  const sections = articleSections(data.description).filter((section) => section.title);
  const links = [
    ...sections.map((section) => ({ id: section.id, title: section.title! })),
    { id: "recording-behavior", title: "Understanding your records" },
    ...(clinicalRangeDataKeys(data.clinical_ranges).length ? [{ id: "clinical-ranges", title: "Reference ranges" }] : []),
    { id: "technical-details", title: "Technical details" },
    { id: "references", title: "Sources and review" },
  ];
  const list = <ol className="mt-3 space-y-2 text-sm leading-5">{links.map((link) => <li key={link.id}><a className="block rounded px-1 py-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2" href={`#${link.id}`}>{link.title}</a></li>)}</ol>;
  return <nav aria-label="On this page" className="lg:sticky lg:top-24">
    <div className="hidden border-l pl-5 lg:block"><p className="font-semibold">On this page</p>{list}</div>
    <details className="rounded-lg border p-4 lg:hidden"><summary className="cursor-pointer font-semibold focus-visible:outline-2">On this page</summary>{list}</details>
  </nav>;
}
