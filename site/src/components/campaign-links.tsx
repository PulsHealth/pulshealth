"use client";

import { useEffect } from "react";
import { campaignStoreURL } from "@/lib/campaigns";

/** Include the header/footer App Store buttons on this landing page. No storage. */
export function CampaignLinks({ campaign }: { campaign: string }) {
  useEffect(() => {
    const href = campaignStoreURL(campaign);
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(link => {
      try { return new URL(link.href).hostname === "apps.apple.com" && new URL(link.href).pathname.includes("6757657354"); }
      catch { return false; }
    });
    const originals = links.map(link => [link, link.href] as const);
    for (const link of links) link.href = href;
    return () => { for (const [link, original] of originals) if (link.href === href) link.href = original; };
  }, [campaign]);
  return null;
}
