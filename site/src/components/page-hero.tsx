import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PageHeroProps {
  /** Small pill above the title: "Free on the App Store · Open source". */
  eyebrow?: ReactNode;
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
  eyebrow,
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
        "w-full border-b bg-gradient-to-b from-background to-muted/40",
        size === "default" ? "pt-20 pb-24 md:pb-28" : "pt-16 pb-14",
        className,
      )}
    >
      <div className="container mx-auto flex max-w-7xl flex-col items-center space-y-6 px-4 text-center">
        {eyebrow && (
          <Badge
            variant="outline"
            className="rounded-full bg-background/60 px-4 py-1 text-sm backdrop-blur-sm"
          >
            {eyebrow}
          </Badge>
        )}

        <h1
          className={cn(
            "max-w-4xl font-bold tracking-tight text-foreground text-balance",
            size === "default" ? "text-4xl md:text-6xl" : "text-4xl md:text-5xl",
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
          <div className="flex flex-col items-center gap-4 pt-2 sm:flex-row">
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
