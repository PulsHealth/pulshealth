import Link from "next/link";

import { getDocLinksByGroup } from "@/lib/docs";
import { cn } from "@/lib/utils";

interface DocsNavProps {
  /** Href of the page being read (`/docs/<slug>/` or a guide's), highlighted in the list. */
  current?: string;
  className?: string;
}

/** Every document and guide, by group. The sidebar on desktop, the "All docs" block on a phone. */
export function DocsNav({ current, className }: DocsNavProps) {
  return (
    <nav aria-label="Documentation" className={cn("text-sm", className)}>
      {getDocLinksByGroup().map(({ group, links }) => (
        <div key={group} className="mb-6 last:mb-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
          <ul className="space-y-0.5">
            {links.map((link) => {
              const active = link.href === current;
              return (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 transition-colors",
                      active
                        ? "bg-brand-muted font-medium text-brand"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {link.title}
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
