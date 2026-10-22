export const analyticsPreferenceEvent = "puls:analytics-preference";
type ReadStorage = Pick<Storage, "getItem">;
export function browserExcluded(storage: ReadStorage): boolean {
  try { return storage.getItem("umami.disabled") === "1"; } catch { return false; }
}
export function excludedInThisBrowser(): boolean {
  try { return typeof window !== "undefined" && browserExcluded(window.localStorage); } catch { return false; }
}
export function setBrowserExcluded(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, excluded: boolean) {
  if (excluded) storage.setItem("umami.disabled", "1");
  else storage.removeItem("umami.disabled");
  if ((storage.getItem("umami.disabled") === "1") !== excluded) throw new Error("Browser preference could not be saved.");
}
export const placements = ["hero", "export_section", "closing_cta", "footer", "pricing", "pro", "other"] as const;
export type AppStorePlacement = typeof placements[number];
export function appStorePlacement(value: unknown): AppStorePlacement {
  return typeof value === "string" && placements.includes(value as AppStorePlacement) ? value as AppStorePlacement : "other";
}
