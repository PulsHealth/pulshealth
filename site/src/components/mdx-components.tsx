import React from "react";
import { type MDXComponents } from "mdx/types";
import Link from "next/link";
import Image from "next/image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, AlertTriangle, CheckCircle, Lightbulb, ExternalLink } from "lucide-react";

// The components a post may use. blog/BLOG_SYSTEM.md documents them; add a
// component there when you add one here.

// Highlighted aside.
function Callout({
  type = "info",
  title,
  icon = true,
  children,
}: {
  type?: "info" | "warning" | "success" | "tip";
  title?: string;
  icon?: boolean;
  children: React.ReactNode;
}) {
  const icons = {
    info: Info,
    warning: AlertTriangle,
    success: CheckCircle,
    tip: Lightbulb,
  };

  const styles = {
    info: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/50 [&>svg]:text-blue-600",
    warning: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50 [&>svg]:text-amber-600",
    success: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/50 [&>svg]:text-green-600",
    tip: "border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/50 [&>svg]:text-purple-600",
  };

  const Icon = icons[type];

  return (
    <Alert className={`my-6 ${styles[type]}`}>
      {icon && <Icon className="h-4 w-4" />}
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className="mt-1 text-base">{children}</AlertDescription>
    </Alert>
  );
}

// Link to a HealthKit data type's knowledge-base page.
function DataTypeLink({
  identifier,
  children,
}: {
  identifier: string;
  children?: React.ReactNode;
}) {
  const displayName =
    children || identifier.replace(/^HK(Quantity|Category|Characteristic)TypeIdentifier/, "");

  return (
    <Link href={`/knowledge-base/types/${identifier}/`} className="font-medium text-brand hover:underline">
      {displayName}
    </Link>
  );
}

// Figure with an optional caption, sized through next/image.
function BlogImage({
  src,
  alt,
  caption,
  width = 800,
  height = 600,
  priority = false,
}: {
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}) {
  return (
    <figure className="my-8 not-prose">
      <div className="relative overflow-hidden rounded-lg border bg-muted/30">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="w-full h-auto"
          priority={priority}
          sizes="(max-width: 768px) 100vw, 800px"
        />
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-sm text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// Inline term with its definition in a hover tooltip.
function Definition({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <span className="relative inline-block group">
      <span className="border-b border-dotted border-muted-foreground/60 cursor-help hover:border-brand dark:border-muted-foreground/40 dark:hover:border-brand transition-colors duration-150">
        {term}
      </span>
      <span
        className="invisible group-hover:visible opacity-0 group-hover:opacity-100 absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-sm leading-relaxed bg-popover text-popover-foreground border border-border rounded-md shadow-md min-w-[200px] max-w-[300px] w-max transition-opacity duration-150 before:content-[''] before:absolute before:top-full before:left-1/2 before:-translate-x-1/2 before:border-8 before:border-transparent before:border-t-border after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-[7px] after:border-transparent after:border-t-popover"
        role="tooltip"
      >
        <span className="font-medium text-foreground">{term}:</span>{" "}
        <span className="text-muted-foreground">{children}</span>
      </span>
    </span>
  );
}

// Summary box; children are a Markdown bullet list.
function KeyTakeaways({
  title = "Key Takeaways",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="my-6 rounded-lg border-l-4 border-brand bg-brand/5 dark:bg-brand/10 p-4 md:p-6">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="h-5 w-5 text-brand shrink-0" />
        <h3 className="text-base font-semibold text-foreground m-0">{title}</h3>
      </div>
      <div className="prose-sm prose-ul:my-0 prose-li:my-1 text-foreground/90 dark:text-foreground/80 [&>ul]:list-none [&>ul]:pl-0 [&>ul>li]:relative [&>ul>li]:pl-5 [&>ul>li]:before:content-[''] [&>ul>li]:before:absolute [&>ul>li]:before:left-0 [&>ul>li]:before:top-[0.6em] [&>ul>li]:before:w-2 [&>ul>li]:before:h-2 [&>ul>li]:before:rounded-full [&>ul>li]:before:bg-brand/60">
        {children}
      </div>
    </div>
  );
}

export const mdxComponents: MDXComponents = {
  Callout,
  DataTypeLink,
  BlogImage,
  Definition,
  KeyTakeaways,

  // Override default elements with better styling
  a: ({ href, children, ...props }) => {
    const isExternal = href?.startsWith("http");
    if (isExternal) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5"
          {...props}
        >
          {children}
          <ExternalLink className="h-3 w-3 ml-0.5" />
        </a>
      );
    }
    return (
      <Link href={href || "#"} {...props}>
        {children}
      </Link>
    );
  },

  // Better table styling
  table: ({ children, ...props }) => (
    <div className="my-6 w-full overflow-x-auto rounded-lg border">
      <table className="w-full" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-muted/50" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="divide-y divide-border" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="border-b border-border last:border-0" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th className="px-4 py-3 text-left text-sm font-semibold text-foreground" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="px-4 py-3 text-sm" {...props}>
      {children}
    </td>
  ),

  // Note: Code blocks (pre/code) are styled by rehype-pretty-code via CSS in globals.css

  // Better blockquote
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-4 border-brand pl-4 italic text-muted-foreground my-6"
      {...props}
    >
      {children}
    </blockquote>
  ),

  // Optimized images using Next.js Image
  img: ({ src, alt, ...props }) => {
    if (!src) return null;
    return (
      <span className="block my-8">
        <Image
          src={src}
          alt={alt || ""}
          width={800}
          height={600}
          className="rounded-lg w-full h-auto"
          sizes="(max-width: 768px) 100vw, 800px"
          {...props}
        />
      </span>
    );
  },
};
