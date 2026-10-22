import Image from "next/image";

import { cn } from "@/lib/utils";
import type { AppStorePlacement } from "@/lib/analytics-preferences";

export const APP_STORE_URL = "https://apps.apple.com/us/app/pulshealth/id6757657354";

/**
 * Apple's official "Download on the App Store" badge, in the black-on-light and
 * white-on-dark variants. Sized to h-10 so it lines up with `Button size="lg"`.
 */
export function AppStoreBadge({ className, href = APP_STORE_URL, placement = "other" }: { className?: string; href?: string; placement?: AppStorePlacement }) {
  return (
    <a
      href={href}
      data-analytics-placement={placement}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Download PulsHealth on the App Store"
      className={cn("inline-block shrink-0", className)}
    >
      <Image
        src="/download_app_store_black.svg"
        alt=""
        width={120}
        height={40}
        className="h-10 w-auto dark:hidden"
      />
      <Image
        src="/download_app_store_white.svg"
        alt=""
        width={120}
        height={40}
        className="hidden h-10 w-auto dark:block"
      />
    </a>
  );
}
