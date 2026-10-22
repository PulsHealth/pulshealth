import manifest from "../../content/campaigns.json";

// Public snapshot exported by Observatory; IDs are campaign labels, never people.
export const campaigns = manifest.variants;
export function campaignStoreURL(campaign: string): string {
  if (!campaigns.some(item => item.id === campaign)) throw new Error("Unknown campaign");
  const url = new URL(`https://apps.apple.com/app/apple-store/id${manifest.appId}`);
  url.search = new URLSearchParams({ pt: manifest.providerToken, ct: campaign, mt: "8" }).toString();
  return url.toString();
}
