import Link from "next/link";

import { docHref, getDocsByGroup } from "@/lib/docs";
import { cn } from "@/lib/utils";

interface DocsNavProps {
  /** Slug of the document being read, highlighted in the list. */
  current?: string;
  className?: string;
}

/** Every rendered document, by group. The sidebar on desktop, the "All docs" block on a phone. */
export function DocsNav({ current, className }: DocsNavProps) {
  return (
    <nav aria-label="Documentation" className={cn("text-sm", className)}>
      {getDocsByGroup().map(({ group, docs }) => (
        <div key={group} className="mb-6 last:mb-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
          <ul className="space-y-0.5">
            {docs.map((doc) => {
              const active = doc.slug === current;
              return (
                <li key={doc.slug}>
                  <Link
                    href={docHref(doc.slug)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 transition-colors",
                      active
                        ? "bg-brand-muted font-medium text-brand"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {doc.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
