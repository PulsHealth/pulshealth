import Link from "next/link";
import { serializeJsonLd } from "@/lib/json-ld";

export function Breadcrumbs({ items }: { items: { name: string; href: string }[] }) {
  const trail = [{ name: "Home", href: "/" }, ...items];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        itemListElement: trail.map((item, index) => ({
          "@type": "ListItem", position: index + 1, name: item.name,
          item: `https://pulshealth.com${item.href}`,
        })),
      }) }} />
      <nav aria-label="Breadcrumb" className="mb-5 text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {trail.map((item, index) => <li key={item.href} className="inline-flex items-center gap-2">
            {index > 0 && <span aria-hidden="true">/</span>}
            {index === trail.length - 1 ? <span aria-current="page">{item.name}</span> : <Link className="inline-block py-2 underline underline-offset-4 hover:text-foreground" href={item.href}>{item.name}</Link>}
          </li>)}
        </ol>
      </nav>
    </>
  );
}
