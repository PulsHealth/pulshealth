import React from "react";
import { type MDXComponents } from "mdx/types";
import Link from "next/link";
import Image from "next/image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, AlertTriangle, CheckCircle, Lightbulb, ExternalLink } from "lucide-react";
import { HeartRateChart } from "@/components/charts/heart-rate-chart";
import { GenericChart, MultiLineChart } from "@/components/charts/generic-chart";
import {
  ClinicalRangesTable,
  DeviceComparisonTable,
  FeatureComparisonTable,
  DataTable,
  ProConComparison,
} from "@/components/charts/comparison-table";
// Client components (use useState)
import {
  Accordion,
  AccordionItem,
  Tabs,
  Tab,
  Definition,
  Citation,
  KeyTakeaways,
} from "@/components/mdx-client-components";

// Callout component for highlighting important information
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

// Link to a HealthKit data type in the knowledge base
function DataTypeLink({
  identifier,
  children,
}: {
  identifier: string;
  children?: React.ReactNode;
}) {
  const displayName = children || identifier.replace(/^HK(Quantity|Category|Characteristic)TypeIdentifier/, "");

  return (
    <Link
      href={`/knowledge-base/types/${identifier}`}
      className="inline-flex items-center gap-1 text-brand hover:underline font-medium"
    >
      {displayName}
      <ExternalLink className="h-3 w-3" />
    </Link>
  );
}

// Feature card for highlighting key points
function FeatureCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>{description}</CardDescription>
      </CardContent>
    </Card>
  );
}

// Solution card that links to a solution page
function SolutionCard({
  title,
  description,
  href,
  children,
}: {
  title: string;
  description: string;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="block no-underline hover:no-underline group">
      <Card className="my-6 border-2 border-border/60 transition-all duration-200 group-hover:border-brand/50 group-hover:shadow-lg group-hover:shadow-brand/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold text-foreground group-hover:text-brand transition-colors">
              {title}
            </CardTitle>
            <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-brand transition-colors shrink-0" />
          </div>
          <CardDescription className="text-sm">{description}</CardDescription>
        </CardHeader>
        {children && (
          <CardContent className="text-sm text-muted-foreground">
            {children}
          </CardContent>
        )}
      </Card>
    </Link>
  );
}

// Stat highlight for showing key numbers
function StatHighlight({
  value,
  label,
  description,
}: {
  value: string;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50 border my-4">
      <span className="text-3xl font-bold text-brand">{value}</span>
      <span className="text-sm font-medium mt-1">{label}</span>
      {description && (
        <span className="text-xs text-muted-foreground mt-1">{description}</span>
      )}
    </div>
  );
}

// Grid for laying out multiple items
function Grid({
  cols = 2,
  children,
}: {
  cols?: 2 | 3 | 4;
  children: React.ReactNode;
}) {
  const gridCols = {
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={`grid ${gridCols[cols]} gap-4 my-6 not-prose`}>
      {children}
    </div>
  );
}

// Tag/badge for inline highlighting
function Tag({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "secondary" | "outline" }) {
  return (
    <Badge variant={variant} className="mx-0.5">
      {children}
    </Badge>
  );
}

// Optimized blog image component with Next.js Image
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

// Quote component for attributed quotes from experts/studies
function Quote({
  author,
  role,
  source,
  children,
}: {
  author: string;
  role?: string;
  source?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="my-8 not-prose">
      <div className="relative border-l-4 border-brand bg-muted/30 dark:bg-muted/20 rounded-r-lg px-6 py-5">
        <span
          className="absolute -top-2 left-4 text-6xl font-serif text-brand/20 dark:text-brand/30 leading-none select-none"
          aria-hidden="true"
        >
          &ldquo;
        </span>
        <blockquote className="relative z-10 text-lg italic text-foreground/90 dark:text-foreground/85 leading-relaxed">
          {children}
        </blockquote>
      </div>
      <figcaption className="mt-4 flex flex-col gap-0.5 pl-6">
        <cite className="not-italic font-medium text-foreground">{author}</cite>
        {(role || source) && (
          <span className="text-sm text-muted-foreground">
            {role}
            {role && source && " — "}
            {source && <em>{source}</em>}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

// Timeline item for showing progression steps
function TimelineItem({
  date,
  label,
  title,
  children,
}: {
  date?: string;
  label?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const displayLabel = date || label;

  return (
    <div className="relative pl-8 pb-8 last:pb-0 group">
      <div className="absolute left-[7px] top-3 bottom-0 w-0.5 bg-border group-last:hidden" />
      <div className="absolute left-0 top-1.5 w-4 h-4 rounded-full bg-brand border-4 border-background" />
      <div className="space-y-1">
        {displayLabel && (
          <span className="text-sm font-semibold text-brand">{displayLabel}</span>
        )}
        {title && (
          <h4 className="text-base font-semibold text-foreground">{title}</h4>
        )}
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

// Timeline container
function Timeline({ children }: { children: React.ReactNode }) {
  return <div className="my-6 not-prose">{children}</div>;
}

// Step component for individual steps
function Step({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="step-content">
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <div className="text-muted-foreground text-sm">{children}</div>
    </div>
  );
}

// Steps container for step-by-step instructions
function Steps({ children }: { children: React.ReactNode }) {
  const childArray = React.Children.toArray(children);
  const stepCount = childArray.filter((child) => React.isValidElement(child)).length;

  return (
    <div className="my-8 not-prose">
      <div className="relative">
        {childArray.map((child, index) => {
          if (!React.isValidElement(child)) return child;
          const isLast = index === stepCount - 1;

          return (
            <div key={index} className="relative pl-10 pb-8 last:pb-0">
              {!isLast && (
                <div className="absolute left-[15px] top-8 bottom-0 w-0.5 bg-border" aria-hidden="true" />
              )}
              <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white text-sm font-semibold">
                {index + 1}
              </div>
              {child}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Video embed component for YouTube and Vimeo
function Video({
  src,
  title,
  caption,
}: {
  src: string;
  title: string;
  caption?: string;
}) {
  const getEmbedUrl = (url: string): string | null => {
    const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (youtubeMatch) return `https://www.youtube.com/embed/${youtubeMatch[1]}`;
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    return null;
  };

  const embedUrl = getEmbedUrl(src);

  if (!embedUrl) {
    return (
      <div className="my-8 p-4 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive text-sm">
        Invalid video URL. Please use a YouTube or Vimeo link.
      </div>
    );
  }

  return (
    <figure className="my-8 not-prose">
      <div className="relative overflow-hidden rounded-lg border bg-muted/30 aspect-video">
        <iframe
          src={embedUrl}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
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

export const mdxComponents: MDXComponents = {
  // Custom components
  Callout,
  DataTypeLink,
  FeatureCard,
  SolutionCard,
  StatHighlight,
  Grid,
  Tag,
  HeartRateChart,
  BlogImage,
  // New components
  Quote,
  Timeline,
  TimelineItem,
  Steps,
  Step,
  Video,
  // Client components
  Accordion,
  AccordionItem,
  Tabs,
  Tab,
  Definition,
  Citation,
  KeyTakeaways,
  // Chart components
  GenericChart,
  MultiLineChart,
  // Table components
  ClinicalRangesTable,
  DeviceComparisonTable,
  FeatureComparisonTable,
  DataTable,
  ProConComparison,

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
