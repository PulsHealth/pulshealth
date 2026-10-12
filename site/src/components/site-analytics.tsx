"use client";

import { useEffect } from "react";
import { trackSiteEvent, type SiteEvent } from "@/lib/site-analytics";

const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_URL;
const websiteId = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID;

export function SiteAnalytics() {
  useEffect(() => {
    if (!endpoint || !websiteId || !["pulshealth.com", "www.pulshealth.com"].includes(location.hostname)) return;
    if (navigator.doNotTrack === "1" || (navigator as Navigator & {globalPrivacyControl?: boolean}).globalPrivacyControl) return;
    window.pulsAnalyticsBeforeSend = (type, payload) => {
      if (!["event", "performance"].includes(type)) return false;
      let referrer = "";
      try { referrer = new URL(String(payload.referrer || "")).origin; } catch { /* direct visit */ }
      return { ...payload, url: location.pathname, referrer, title: "", data: undefined, id: undefined };
    };
    if (!document.getElementById("site-analytics")) {
      const script = document.createElement("script");
      script.id = "site-analytics";
      script.src = `${endpoint.replace(/\/$/, "")}/script.js`;
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
    function click(event: MouseEvent) {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      let name: SiteEvent | undefined;
      try {
        const url = new URL(link.href, location.origin);
        if (url.hostname === "apps.apple.com") name = "app_store_click";
        else if (url.hostname === "github.com" && url.pathname.startsWith("/PulsHealth/")) name = "github_click";
        else if (url.hostname === "app.pulshealth.com") name = url.pathname.startsWith("/signup") ? "hosted_signup_click" : url.pathname.startsWith("/demo") ? "demo_click" : "hosted_signin_click";
        else if (url.origin === location.origin && url.pathname.startsWith("/docs")) name = "docs_click";
        else if (url.protocol === "mailto:") name = "contact_click";
      } catch { return; }
      if (name) trackSiteEvent(name);
    }
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  return null;
}
