"use client";

import { Search } from "lucide-react";
import { useSearch } from "@/components/search-context";
import { Button } from "@/components/ui/button";

export function SearchTrigger() {
  const { setOpen } = useSearch();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="gap-2 text-muted-foreground"
    >
      <Search className="h-4 w-4" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
        <span className="text-xs">⌘</span>K
      </kbd>
    </Button>
  );
}
