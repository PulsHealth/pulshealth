import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeroProps {
  title: ReactNode;
  /** One or two sentences under the title. */
  lede?: ReactNode;
  /** Buttons. Rendered in a wrapping row. */
  children?: ReactNode;
  /** Fine print under the buttons. */
  note?: ReactNode;
  size?: "default" | "compact";
  className?: string;
}

/**
 * The hero every page opens with. One component so the six copies of this
 * markup stop drifting apart, and so a design change lands everywhere at once.
 */
export function PageHero({
  title,
  lede,
  children,
  note,
  size = "default",
  className,
}: PageHeroProps) {
  return (
    <section
      className={cn(
        "w-full border-b bg-background",
        size === "default" ? "py-14 md:py-20" : "py-10 md:py-14",
        className,
      )}
    >
      <div className="container mx-auto flex max-w-7xl flex-col items-center space-y-6 px-5 text-center">
        <h1
          className={cn(
            "max-w-4xl font-[550] tracking-[-0.05em] leading-[1.08] text-foreground text-balance",
            size === "default" ? "text-[clamp(36px,5vw,64px)]" : "text-[clamp(32px,4vw,48px)]",
          )}
        >
          {title}
        </h1>

        {lede && (
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl text-pretty">
            {lede}
          </p>
        )}

        {children && (
          <div className="flex w-full max-w-2xl flex-col items-center justify-center gap-4 pt-2 sm:flex-row">
            {children}
          </div>
        )}

        {note && (
          <p className="max-w-xl text-sm text-muted-foreground">{note}</p>
        )}
      </div>
    </section>
  );
}
