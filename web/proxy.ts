import { NextResponse, type NextRequest } from "next/server";

import { AUTH_REALM, authorize } from "@/lib/auth";
import { UUID_RE } from "@/lib/config";
import { USER_COOKIE, userCookieOptions } from "@/lib/viewer";

// Optional HTTP Basic authentication in front of the whole viewer (SRV-10).
// With WEB_AUTH_PASSWORD unset this is a pass-through and the viewer behaves
// exactly as it did before; with it set, every route but /api/healthz needs
// the password. See lib/auth.ts for why Basic, and web/README.md for how to
// turn it off again.
//
// `proxy.ts` is Next.js 16's middleware convention (the old `middleware.ts`
// is deprecated). It always runs on the Node.js runtime and takes no matcher
// config, so it sees every request — no exemption to get wrong — and reads
// WEB_AUTH_PASSWORD from the process environment per request. One published
// image therefore serves both the authenticated and the open configuration:
// edit `.env`, `docker compose up -d web`, done.
//
// It also honours `?user=<uuid>` on any page (SRV-11): the id goes into the
// `puls-user` cookie and the browser is sent to the same URL without the
// parameter, so a bookmark or a Grafana link can pick a person. That happens
// after the password check, so the link is no way around it.
export default async function proxy(request: NextRequest) {
  const decision = await authorize({
    pathname: request.nextUrl.pathname,
    authorization: request.headers.get("authorization"),
    password: process.env.WEB_AUTH_PASSWORD,
  });

  if (decision === "challenge") {
    // Nothing about the attempt is logged: the Authorization header holds the
    // password, and a near-miss in a log file is still a password in a log file.
    return new NextResponse("Authentication required.\n", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const chosen = userFromQuery(request);
  if (chosen) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("user");
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(USER_COOKIE, chosen, userCookieOptions(url.protocol === "https:"));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  return NextResponse.next();
}

// The `?user=` value when this is a page GET carrying a UUID; null otherwise.
// Route handlers keep their query string (only pages take the shortcut), and
// a value that is not a UUID is left alone for the page to ignore. Existence
// is not checked here — there is no database in middleware — so an unknown id
// renders an empty viewer, and the sidebar's switcher offers the way back.
function userFromQuery(request: NextRequest): string | null {
  if (request.method !== "GET") return null;
  const { pathname, searchParams } = request.nextUrl;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return null;
  const value = searchParams.get("user");
  if (!value || !UUID_RE.test(value)) return null;
  return value.toLowerCase();
}
