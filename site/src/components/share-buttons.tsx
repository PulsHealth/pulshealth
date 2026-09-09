"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link2, Check, Twitter, Facebook, Linkedin, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShareButtonsProps {
  url: string;
  title: string;
  description?: string;
  tags?: string[];
  className?: string;
}

export function ShareButtons({
  url,
  title,
  description,
  className,
}: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const shareLinks = {
    twitter: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: description,
          url,
        });
      } catch {
        // User cancelled or share failed silently
      }
    }
  };

  const hasNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Native Share (mobile) */}
      {hasNativeShare && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleNativeShare}
          aria-label="Share"
          className="md:hidden"
        >
          <Share2 className="h-4 w-4" />
        </Button>
      )}

      {/* Copy Link */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleCopyLink}
        aria-label={copied ? "Copied!" : "Copy link"}
        className={cn(hasNativeShare && "hidden md:inline-flex")}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Link2 className="h-4 w-4" />
        )}
      </Button>

      {/* Twitter/X */}
      <Button
        variant="ghost"
        size="icon-sm"
        asChild
        className={cn(hasNativeShare && "hidden md:inline-flex")}
      >
        <a
          href={shareLinks.twitter}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on X (Twitter)"
        >
          <Twitter className="h-4 w-4" />
        </a>
      </Button>

      {/* Facebook */}
      <Button
        variant="ghost"
        size="icon-sm"
        asChild
        className={cn(hasNativeShare && "hidden md:inline-flex")}
      >
        <a
          href={shareLinks.facebook}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on Facebook"
        >
          <Facebook className="h-4 w-4" />
        </a>
      </Button>

      {/* LinkedIn */}
      <Button
        variant="ghost"
        size="icon-sm"
        asChild
        className={cn(hasNativeShare && "hidden md:inline-flex")}
      >
        <a
          href={shareLinks.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on LinkedIn"
        >
          <Linkedin className="h-4 w-4" />
        </a>
      </Button>
    </div>
  );
}
