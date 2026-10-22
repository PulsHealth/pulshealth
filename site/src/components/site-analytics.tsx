"use client";

import { useEffect } from "react";
import { trackSiteEvent, type SiteEvent } from "@/lib/site-analytics";

import {analyticsPreferenceEvent, excludedInThisBrowser, appStorePlacement} from "@/lib/analytics-preferences";

const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_URL;
const websiteId = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID;

export function SiteAnalytics() {
  useEffect(() => {
    if (!endpoint || !websiteId || !["pulshealth.com", "www.pulshealth.com"].includes(location.hostname)) return;
    if (navigator.doNotTrack === "1" || (navigator as Navigator & {globalPrivacyControl?: boolean}).globalPrivacyControl) return;
    const trackerURL = `${endpoint.replace(/\/$/, "")}/script.js`;
    window.pulsAnalyticsBeforeSend = (type, payload) => {
      if (excludedInThisBrowser() || !["event", "performance"].includes(type)) return false;
      let referrer = "";
      try { referrer = new URL(String(payload.referrer || "")).origin; } catch { /* direct visit */ }
      return { ...payload, url: location.pathname, referrer, title: "", data: payload.name === "app_store_click" && payload.data && typeof payload.data === "object" && "placement" in payload.data ? {placement: appStorePlacement((payload.data as {placement: unknown}).placement)} : undefined, id: undefined };
    };
    function install() {
      if (excludedInThisBrowser()) return;
      if (!document.getElementById("site-analytics")) {
        const script = document.createElement("script");
        script.id = "site-analytics";
        script.src = trackerURL;
        script.async = true;
        script.dataset.websiteId = websiteId;
        script.dataset.domains = "pulshealth.com,www.pulshealth.com";
        script.dataset.excludeSearch = "true";
        script.dataset.excludeHash = "true";
        script.dataset.doNotTrack = "true";
        script.dataset.performance = "true";
        script.dataset.beforeSend = "pulsAnalyticsBeforeSend";
        document.head.appendChild(script);
      }
    }
    install();
    window.addEventListener(analyticsPreferenceEvent, install);
    window.addEventListener("storage", install);
    function click(event: MouseEvent) {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      let name: SiteEvent | undefined;
      try {
        const url = new URL(link.href, location.origin);
        if (url.hostname === "apps.apple.com" || (url.origin === location.origin && /^\/r\/[a-z0-9][a-z0-9-]{2,63}\/store$/.test(url.pathname))) name = "app_store_click";
        else if (url.hostname === "github.com" && url.pathname.startsWith("/PulsHealth/")) name = "github_click";
        else if (url.hostname === "app.pulshealth.com") name = url.pathname.startsWith("/signup") ? "hosted_signup_click" : url.pathname.startsWith("/demo") ? "demo_click" : "hosted_signin_click";
        else if (url.origin === location.origin && url.pathname.startsWith("/docs")) name = "docs_click";
        else if (url.protocol === "mailto:") name = "contact_click";
      } catch { return; }
      if (name) trackSiteEvent(name, name === "app_store_click" ? {placement: appStorePlacement(link.dataset.analyticsPlacement)} : undefined);
    }
    document.addEventListener("click", click);
    return () => {document.removeEventListener("click", click);window.removeEventListener(analyticsPreferenceEvent, install);window.removeEventListener("storage", install);};
  }, []);
  return null;
}
