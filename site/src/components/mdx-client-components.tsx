"use client";

import React, { useState } from "react";
import { ChevronDown, Lightbulb, ExternalLink } from "lucide-react";

// Accordion item component for FAQ sections
export function AccordionItem({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-4 text-left font-medium text-foreground transition-colors hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`grid transition-all duration-200 ease-in-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="pb-4 pt-0 text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Accordion container component
export function Accordion({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 rounded-lg border border-border bg-card/50 dark:bg-card/30 px-4">
      {children}
    </div>
  );
}

// Tab component - used as children of Tabs
export function Tab({
  label: _label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  // Tab is a data container; rendering is handled by Tabs parent
  return <>{children}</>;
}

// Tabs component for organizing content into switchable panels
export function Tabs({ children }: { children: React.ReactNode }) {
  const [activeIndex, setActiveIndex] = useState(0);

  const tabs = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<{ label: string; children: React.ReactNode }> =>
      React.isValidElement(child)
  );

  if (tabs.length === 0) {
    return <div>{children}</div>;
  }

  return (
    <div className="my-6 not-prose">
      <div className="flex border-b border-border overflow-x-auto">
        {tabs.map((tab, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors relative
              ${activeIndex === index ? "text-brand" : "text-muted-foreground hover:text-foreground"}
            `}
          >
            {tab.props.label}
            {activeIndex === index && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand" />
            )}
          </button>
        ))}
      </div>
      <div className="pt-4 prose prose-zinc dark:prose-invert max-w-none">
        {tabs[activeIndex]?.props.children}
      </div>
    </div>
  );
}

// Definition component with hover tooltip
export function Definition({
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

// Citation component with hover details
export function Citation({
  id,
  authors,
  title,
  journal,
  year,
  doi,
  url,
}: {
  id: number;
  authors: string;
  title: string;
  journal: string;
  year: number;
  doi?: string;
  url?: string;
}) {
  const link = doi ? `https://doi.org/${doi}` : url;

  return (
    <span className="relative inline-block group">
      <sup
        className="cursor-pointer text-brand hover:text-brand/80 font-medium text-xs px-0.5 transition-colors"
        role="button"
        tabIndex={0}
        aria-label={`Citation ${id}: ${title}`}
      >
        [{id}]
      </sup>
      <span
        className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 sm:w-80 p-3 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all duration-200 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto"
        role="tooltip"
      >
        <span className="block text-sm font-medium text-foreground mb-1 leading-snug">
          {title}
        </span>
        <span className="block text-xs text-muted-foreground mb-1">{authors}</span>
        <span className="block text-xs text-muted-foreground italic">
          {journal}, {year}
        </span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-xs text-brand hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {doi ? `DOI: ${doi}` : "View source"}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <span className="absolute left-1/2 -translate-x-1/2 top-full border-8 border-transparent border-t-popover" />
      </span>
    </span>
  );
}

// Key takeaways summary box
export function KeyTakeaways({
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
