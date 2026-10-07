// Which pages the root layout serves without the sidebar, whatever the
// session: proxy.ts passes the path in PATH_HEADER (always overwriting it).

export const PATH_HEADER = "x-puls-pathname";

/** The OAuth consent and error pages: another app's sign-in, not the viewer. */
export function isBarePage(pathname: string | null | undefined): boolean {
  return pathname === "/connect/iphone" || pathname === "/oauth" || (pathname ?? "").startsWith("/oauth/");
}
