/** Optional telemetry must finish promptly and must never be retried as a duplicate count. */
export async function postAudience(url: string, body: string, timeoutMs = 5_000): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      keepalive: true,
      signal: controller.signal,
    });
    // fetch resolves at headers. We need no response content, so stop streaming it.
    await response.body?.cancel();
  } catch {
    // A slow/offline collector must not interrupt browsing or cause a retry.
  } finally {
    clearTimeout(timeout);
  }
}
