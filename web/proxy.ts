import { NextResponse, type NextRequest } from "next/server";

import { AUTH_REALM, authorize } from "@/lib/auth";

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
  return NextResponse.next();
}
