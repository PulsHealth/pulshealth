"use client";

import { Search } from "lucide-react";
import { useSearch } from "@/components/search-context";

export function SearchTrigger() {
  const { setOpen } = useSearch();
  return <button type="button" className="site-action site-outline site-search" onClick={() => setOpen(true)} aria-label="Search PulsHealth website">
    <Search aria-hidden /><span>Search</span><kbd><span>⌘</span>K</kbd>
  </button>;
}
