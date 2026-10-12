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
export function trackSiteEvent(name: SiteEvent) {
  if (typeof window === "undefined") return;
  try { window.umami?.track(name); } catch { /* Analytics must not interrupt the action. */ }
}
