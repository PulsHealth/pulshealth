import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import styles from "./page-hero.module.css";

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
        styles.hero,
        "w-full border-b",
        size === "default" ? "pt-20 pb-24 md:pb-28" : "pt-16 pb-14",
        className,
      )}
    >
      <div className="container mx-auto flex max-w-7xl flex-col items-start space-y-6 px-6 text-left">
        <h1
          className={cn(
            "max-w-4xl font-medium tracking-tight text-foreground text-balance",
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
          <div className="flex flex-col items-start gap-4 pt-2 sm:flex-row">
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
