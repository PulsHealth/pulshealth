// Which pages the root layout serves without dashboard navigation, whatever
// the session: proxy.ts passes the path in PATH_HEADER (always overwriting it).

export const PATH_HEADER = "x-puls-pathname";

/** Authentication and connection flows stay focused, including from the demo. */
export function isBarePage(pathname: string | null | undefined): boolean {
  return pathname === "/login"
    || pathname === "/signup"
    || (pathname ?? "").startsWith("/invite/")
    || (pathname ?? "").startsWith("/deletion/")
    || pathname === "/forgot-password"
    || (pathname ?? "").startsWith("/reset-password/")
    || pathname === "/connect/account"
    || pathname === "/connect/iphone"
    || pathname === "/oauth"
    || (pathname ?? "").startsWith("/oauth/");
}
