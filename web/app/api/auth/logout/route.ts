import type { NextRequest } from "next/server";

import { accountsOnly, clearSessionCookie, field, readForm, seeOther } from "@/lib/accounts/http";
import { deleteSession, SESSION_COOKIE, tokenHash } from "@/lib/accounts/session";
import { safeReturnPath } from "@/lib/viewer";

// Sign out: the session row is deleted (not just the cookie), so a copy of
// the cookie stops working too. Reachable without a live session — signing
// out of one that already expired should not be an error — but, like every
// POST, only from this origin (proxy.ts).
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const off = accountsOnly();
  if (off) return off;
  const id = tokenHash(request.cookies.get(SESSION_COOKIE)?.value);
  if (id) {
    try {
      await deleteSession(id);
    } catch (e) {
      console.error("[puls-web] sign-out could not delete the session:", e instanceof Error ? e.message : e);
    }
  }
  const next = safeReturnPath(field(await readForm(request), "next"));
  return clearSessionCookie(seeOther(`/login?notice=signed-out${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`));
}
