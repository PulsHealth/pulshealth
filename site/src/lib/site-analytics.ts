import {browserExcluded, appStorePlacement} from "./analytics-preferences";
export type SiteEvent =
  | "app_store_click" | "github_click" | "hosted_signin_click" | "hosted_signup_click" | "demo_click" | "docs_click" | "contact_click"
  | "updates_submit" | "updates_success" | "updates_error"
  | "consulting_submit" | "consulting_success" | "consulting_error" | "article_share";

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Record<string, string>) => unknown };
    pulsAnalyticsBeforeSend?: (type: string, payload: Record<string, unknown>) => Record<string, unknown> | false;
  }
}

/** Only a fixed action name; never a form value, share URL, email or search query. */
export function trackSiteEvent(name: SiteEvent, data?: {placement: string}) {
  if (typeof window === "undefined") return;
  try { if (!browserExcluded(localStorage)) window.umami?.track(name, name === "app_store_click" && data ? {placement: appStorePlacement(data.placement)} : undefined); } catch { /* Analytics must not interrupt the action. */ }
}

export function sanitizeSitePayload(type: string, payload: Record<string, unknown>, pathname: string): Record<string, unknown> | false {
  if (!["event", "performance"].includes(type)) return false;
  let referrer = "";
  try { referrer = new URL(String(payload.referrer || "")).origin; } catch { /* direct */ }
  const data = payload.data as {placement?: unknown} | undefined;
  return {...payload, url: pathname, referrer, title: "", id: undefined,
    data: payload.name === "app_store_click" && data && "placement" in data ? {placement: appStorePlacement(data.placement)} : undefined};
}
