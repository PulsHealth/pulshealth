"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useSearch } from "@/components/search-context";
import type { SearchItem } from "@/lib/types";

const GlobalSearchDialog = dynamic(
  () => import("@/components/global-search"),
  { ssr: false }
);

// The index is a static file (src/app/search-index.json/route.ts) fetched the
// first time the dialog opens, not inlined into every page. One promise per
// page load: a second open reuses it. A failed fetch logs and shows an empty
// index for the rest of the page load.
let indexPromise: Promise<SearchItem[]> | null = null;

function loadSearchIndex(): Promise<SearchItem[]> {
  if (!indexPromise) {
    indexPromise = fetch("/search-index.json")
      .then((res) => {
        if (!res.ok) throw new Error(`search-index.json: HTTP ${res.status}`);
        return res.json() as Promise<SearchItem[]>;
      })
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

export function SearchDialogLoader() {
  const { open } = useSearch();
  const [items, setItems] = useState<SearchItem[] | null>(null);

  useEffect(() => {
    if (!open || items !== null) return;
    let cancelled = false;
    loadSearchIndex()
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, items]);

  if (!open) return null;

  return <GlobalSearchDialog items={items ?? []} loading={items === null} />;
}
