export const campaignCookie = "__Host-puls-campaign";
export const plainAppStoreURL = "https://apps.apple.com/us/app/pulshealth/id6757657354";
const slugPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** Only a shared publication/campaign slug, never a person or click ID. */
export function referralSlug(cookie: string): string | null {
  const values = cookie.split(";").map(s => s.trim()).filter(s => s.startsWith(campaignCookie + "="));
  if (values.length !== 1) return null;
  try {
    const value = decodeURIComponent(values[0].slice(campaignCookie.length + 1));
    return slugPattern.test(value) ? value : null;
  } catch { return null; }
}

export function referralStoreURL(slug: string | null): string {
  return slug && slugPattern.test(slug) ? `https://pulshealth.com/r/${slug}/store` : plainAppStoreURL;
}

export function isPulsAppStoreLink(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "apps.apple.com" && /\/id6757657354\/?$/.test(u.pathname);
  } catch { return false; }
}
