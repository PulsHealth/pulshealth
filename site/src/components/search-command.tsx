"use client";

import * as React from "react";
import { useSearch } from "@/components/search-context";

export function SearchCommand() {
  const { setOpen } = useSearch();

  return (
    <button
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input hover:bg-accent hover:text-accent-foreground px-4 py-2 relative h-11 w-full justify-start rounded-[0.75rem] bg-muted/50 text-base font-normal text-muted-foreground sm:pr-12 md:w-40 lg:w-full border-zinc-200 dark:border-zinc-800"
    >
      <span className="hidden lg:inline-flex">Search HealthKit data types...</span>
      <span className="inline-flex lg:hidden">Search...</span>
      <kbd className="pointer-events-none absolute right-[0.5rem] top-[0.65rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  );
}
