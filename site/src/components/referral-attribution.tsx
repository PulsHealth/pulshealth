"use client";

import { useEffect } from "react";
import { campaignCookie, isPulsAppStoreLink, referralSlug, referralStoreURL } from "@/lib/referral-attribution";

/** Keep the address bar clean; carry only campaign context to the store button. */
export function ReferralAttribution() {
  useEffect(() => {
    if (location.hostname !== "pulshealth.com") return;
    const originals = new WeakMap<HTMLAnchorElement, string>();
    function update() {
      const optedOut = navigator.doNotTrack === "1" || (navigator as Navigator & {globalPrivacyControl?: boolean}).globalPrivacyControl;
      if (optedOut) document.cookie = `${campaignCookie}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
      const slug = optedOut ? null : referralSlug(document.cookie);
      for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        if (isPulsAppStoreLink(link.href)) originals.set(link, link.href);
        const original = originals.get(link);
        if (original) link.href = slug ? referralStoreURL(slug) : original;
      }
    }
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {childList: true, subtree: true});
    // Refresh at interaction time too: a campaign can expire while a tab stays open.
    for (const event of ["pointerdown", "keydown", "click", "focusin"]) document.addEventListener(event, update, true);
    window.addEventListener("pageshow", update);
    return () => {
      observer.disconnect();
      for (const event of ["pointerdown", "keydown", "click", "focusin"]) document.removeEventListener(event, update, true);
      window.removeEventListener("pageshow", update);
    };
  }, []);
  return null;
}
