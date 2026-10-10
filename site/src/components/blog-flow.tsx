import type { ReactNode } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";

/** A reading-order diagram: HTML text stays legible on phones and in both themes. */
export function BlogFlow({ title, caption, children }: {
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure className="not-prose my-10 overflow-hidden rounded-2xl border border-border bg-muted/20">
      <div className="border-b border-border px-5 py-5 sm:px-7">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">At a glance</p>
        <p className="text-xl font-semibold leading-snug text-foreground">{title}</p>
      </div>
      <div className="divide-y divide-border px-5 sm:px-7">
        {children}
      </div>
      <figcaption className="border-t border-border bg-muted/30 px-5 py-4 text-sm leading-relaxed text-muted-foreground sm:px-7">{caption}</figcaption>
    </figure>
  );
}

export function FlowRow({ label, steps, note }: { label: string; steps: string; note: string }) {
  return (
    <div className="py-5">
      <p className="mb-3 text-sm font-semibold text-foreground">{label}</p>
      <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch" aria-label={label}>
        {steps.split(" | ").map((step, index) => (
          <li key={step} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            {index > 0 && <>
              <ArrowDown aria-hidden="true" className="mx-auto h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
              <ArrowRight aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
            </>}
            <span className="flex h-full min-h-14 w-full items-center justify-center rounded-lg border border-brand/30 bg-brand/5 px-3 py-3 text-center text-sm font-medium leading-snug text-foreground dark:bg-brand/10">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}
