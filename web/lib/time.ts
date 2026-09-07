import { DEFAULT_TIME_ZONE } from "./config";

declare global {
  interface Window {
    __PULS_TIME_ZONE__?: string;
  }
}

// The layout writes the server's configured zone onto window before hydration,
// so server and client formatting stay identical even when the default changes.
export function appTimeZone(): string {
  if (typeof window !== "undefined") {
    return window.__PULS_TIME_ZONE__ || DEFAULT_TIME_ZONE;
  }
  return process.env.PULS_TIME_ZONE || DEFAULT_TIME_ZONE;
}

export function hourInTimeZone(date: Date, timeZone = appTimeZone()): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date).find((part) => part.type === "hour")?.value;
  return Number(hour ?? 0);
}

export function greetingAt(date: Date, timeZone = appTimeZone()): string {
  const hour = hourInTimeZone(date, timeZone);
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
