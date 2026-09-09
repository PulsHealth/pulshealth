"use client";

import dynamic from "next/dynamic";
import { useSearch } from "@/components/search-context";
import type { SearchItem } from "@/lib/types";

const GlobalSearchDialog = dynamic(
  () => import("@/components/global-search"),
  { ssr: false }
);

export function SearchDialogLoader({ items }: { items: SearchItem[] }) {
  const { open } = useSearch();

  if (!open) return null;

  return <GlobalSearchDialog items={items} />;
}
