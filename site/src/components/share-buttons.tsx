"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Link2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};

interface ShareButtonsProps {
  url: string;
  title: string;
  description?: string;
  className?: string;
}

/**
 * Copy the link, or hand it to the OS share sheet where one exists. No
 * network-specific buttons: they add third-party requests for a page that
 * makes none, and a share sheet already knows where the reader posts.
 */
export function ShareButtons({ url, title, description, className }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  // Read on the client only: `navigator` does not exist during the static
  // export, and the server snapshot keeps hydration consistent.
  const canShare = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access refused (insecure context or permission); the
      // address bar still has the URL, so there is nothing to show.
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title, text: description, url });
    } catch {
      // The reader dismissed the sheet.
    }
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={copyLink}
        aria-live="polite"
        className="text-muted-foreground"
      >
        {copied ? <Check className="text-green-600 dark:text-green-500" /> : <Link2 />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      {canShare && (
        <Button variant="ghost" size="sm" onClick={share} className="text-muted-foreground">
          <Share2 />
          Share
        </Button>
      )}
    </div>
  );
}
