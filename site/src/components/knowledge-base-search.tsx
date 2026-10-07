"use client";

import { Search } from "lucide-react";
import { useSearch } from "@/components/search-context";
import { cn } from "@/lib/utils";

export function KnowledgeBaseSearch({ className }: { className?: string }) {
  const { setOpen } = useSearch();

  return (
    <button
      onClick={() => setOpen(true)}
      className={cn(
        "flex w-full cursor-text items-center gap-3 rounded-xl border bg-card px-4 py-3 text-muted-foreground shadow-sm transition-all hover:border-brand/40 hover:shadow-md",
        className,
      )}
    >
      <Search className="h-5 w-5 shrink-0" aria-hidden />
      <span className="flex-1 truncate text-left">Search 178 health data types…</span>
      <kbd className="hidden h-6 items-center gap-1 rounded border bg-muted px-2 font-mono text-xs sm:inline-flex">
        <span>⌘</span>K
      </kbd>
    </button>
  );
}
