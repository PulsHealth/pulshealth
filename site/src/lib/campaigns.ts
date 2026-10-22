import manifest from "../../content/campaigns.json";

// Public snapshot exported by Observatory. Keep legacy IDs for homepage redirects;
// new ads use https://pulshealth.com/ directly, without campaign-specific pages.
export const campaigns = manifest.variants;
