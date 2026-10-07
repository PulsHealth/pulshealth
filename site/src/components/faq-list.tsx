import type { FaqItem } from "@/lib/faq";

/** Questions that open one at a time, shared by the home and support pages. */
export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y rounded-xl border bg-card">
      {items.map((item) => (
        <details key={item.q} className="group px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
            {item.q}
            <span className="font-mono text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>
              +
            </span>
          </summary>
          <p className="mt-3 text-muted-foreground text-pretty">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
