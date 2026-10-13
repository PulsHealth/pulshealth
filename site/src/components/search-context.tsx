"use client";

import * as React from "react";

const SearchContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

export function useSearch() {
  const context = React.useContext(SearchContext);
  if (!context) {
    throw new Error("useSearch must be used within a SearchProvider");
  }
  return context;
}

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    // The separately hosted dashboard links directly to public-site search.
    const hashSearch = () => { if (window.location.hash === "#search") setOpen(true); };
    hashSearch();
    window.addEventListener("hashchange", hashSearch);
    document.addEventListener("keydown", down);
    return () => { document.removeEventListener("keydown", down); window.removeEventListener("hashchange", hashSearch); };
  }, []);

  return (
    <SearchContext.Provider value={{ open, setOpen }}>
      {children}
    </SearchContext.Provider>
  );
}
