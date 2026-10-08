"use client";

import { createContext, useContext } from "react";
import { DEFAULT_TIME_ZONE } from "@/lib/config";

// A request-specific value shared by SSR and hydration. Never put an account's
// zone in module state: multiple accounts render concurrently on the server.
const TimeZoneContext = createContext(DEFAULT_TIME_ZONE);

export function TimeZoneProvider({ timeZone, children }: { timeZone: string; children: React.ReactNode }) {
  return <TimeZoneContext.Provider value={timeZone}>{children}</TimeZoneContext.Provider>;
}

export function useTimeZone(): string {
  return useContext(TimeZoneContext);
}
