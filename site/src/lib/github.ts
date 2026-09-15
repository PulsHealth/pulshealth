export const GITHUB_REPO = "PulsHealth/pulshealth";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

export interface RepoStats {
  stars: number | null;
  /** Latest release tag, e.g. "v0.1.0", or null before the first release. */
  latestTag: string | null;
}

/**
 * Fetched once at build time (the site is a static export). Any failure —
 * offline build, rate limit, no releases yet — degrades to nulls and the UI
 * simply omits the number. `GITHUB_TOKEN`, if set, lifts the anonymous rate
 * limit in CI.
 */
export async function getRepoStats(): Promise<RepoStats> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pulshealth.com build",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const stats: RepoStats = { stars: null, latestTag: null };

  try {
    const repo = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { headers, cache: "force-cache" });
    if (repo.ok) {
      const json = (await repo.json()) as { stargazers_count?: number };
      if (typeof json.stargazers_count === "number") stats.stars = json.stargazers_count;
    }
  } catch {
    // Offline or blocked: leave null.
  }

  try {
    const release = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers, cache: "force-cache" });
    if (release.ok) {
      const json = (await release.json()) as { tag_name?: string };
      if (json.tag_name) stats.latestTag = json.tag_name;
    }
  } catch {
    // No release yet, or offline.
  }

  return stats;
}

/**
 * A star count worth printing, or null. A young repository's single-digit
 * count says less than nothing on a landing page, so the UI shows plain
 * "GitHub" until there is a number worth having.
 */
export function formatStars(stars: number | null): string | null {
  if (stars === null || stars < 50) return null;
  if (stars >= 1000) return `${(stars / 1000).toFixed(stars >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(stars);
}
