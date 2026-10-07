import { NextResponse, type NextRequest } from "next/server";

import { requestIp, seeOther, setSessionCookie } from "@/lib/accounts/http";
import { demoSessions, refundAll, takeAll } from "@/lib/accounts/ratelimit";
import { createDemoSession, DEMO_SESSION_MAX_AGE_SECONDS, findSession, SESSION_COOKIE } from "@/lib/accounts/session";
import { demoAccountProblem, findDemoAccount } from "@/lib/accounts/store";
import { demoUserId } from "@/lib/mode";

// "See the live demo" (accounts mode with WEB_DEMO_USER set; a 404
// otherwise): signs the browser into the shared demo account, which holds
// sample data, with no password, and sends it to the viewer. proxy.ts lets
// this path through without a session (lib/accounts/policy.ts), still only
// over HTTPS.
//
// - A browser that already holds a live session — anyone's, the demo's
//   included — is sent on to / and its session left alone, so no other site
//   can link a signed-in person into the demo and out of their own account.
// - Otherwise a new session, two hours from now, never sliding, with no user
//   agent or address stored (lib/accounts/session.ts createDemoSession).
//   Twenty an hour per client address, from a bucket of its own: this is a
//   GET, so it never touches the sign-in failure buckets.
// - The account must be fit for strangers (store.ts demoAccountProblem);
//   when it is not, the answer is a 503 and the log says why, naming no one.
//
// Everything a demo session might change is refused where it is changed
// (lib/accounts/http.ts refuseDemo), not here.
export const dynamic = "force-dynamic";

function unavailable(): NextResponse {
  return new NextResponse("The demo is unavailable right now. Try again later.\n", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300" },
  });
}

const WHY = {
  missing: "has no viewer account; create it with make web-demo",
  disabled: "has a disabled account, or one without a password hash",
  admin: "has an administrator's account, which strangers must never hold",
  "self-service": "was made by an approved sign-up; the demo must be a user the operator made",
} as const;

export async function GET(request: NextRequest) {
  const userId = demoUserId();
  if (!userId) {
    return new NextResponse("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  let keys: string[] | null = null;
  try {
    if (await findSession(request.cookies.get(SESSION_COOKIE)?.value)) return seeOther("/");

    keys = [`ip:${requestIp(request)}`];
    if (!takeAll(demoSessions, keys).allowed) {
      keys = null;
      return seeOther("/login?error=demo_busy");
    }
    const account = await findDemoAccount(userId);
    const problem = demoAccountProblem(account);
    if (problem || !account) {
      refundAll(demoSessions, keys);
      console.error(`[puls-web] /demo is unavailable: the WEB_DEMO_USER user ${WHY[problem ?? "missing"]} (web/README.md, "Demo account").`);
      return unavailable();
    }
    const token = await createDemoSession(account.id);
    return setSessionCookie(seeOther("/"), token, DEMO_SESSION_MAX_AGE_SECONDS);
  } catch (e) {
    if (keys) refundAll(demoSessions, keys);
    console.error("[puls-web] /demo failed:", e instanceof Error ? e.message : e);
    return unavailable();
  }
}
