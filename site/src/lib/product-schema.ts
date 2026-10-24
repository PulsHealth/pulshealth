import { APP_STORE_URL } from "@/components/app-store-badge";
import { GITHUB_URL } from "@/lib/github";

export const appJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": "https://pulshealth.com/#app",
  url: "https://pulshealth.com/",
  publisher: { "@id": "https://pulshealth.com/#org" },
  name: "PulsHealth",
  operatingSystem: "iOS 17 or later",
  applicationCategory: "HealthApplication",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  installUrl: APP_STORE_URL,
  license: "https://www.apache.org/licenses/LICENSE-2.0",
  codeRepository: GITHUB_URL,
  isAccessibleForFree: true,
  description: "Sync, export, and control your Apple Health data. Automatic background sync to a compatible database, flexible CSV and JSON exports, and connections to compatible AI tools through your database. Free to download and open source, with optional Pro subscriptions for full history and unlimited sync types.",
};
