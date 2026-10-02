import type { NextRequest } from "next/server";

import { accountsOnly, field, readForm, requestIp, seeOther, setSessionCookie } from "@/lib/accounts/http";
import { hashPassword, newPasswordProblem } from "@/lib/accounts/password";
import { authFailures, checkAll, failAll, failureKeys } from "@/lib/accounts/ratelimit";
import { createSession, tokenHash } from "@/lib/accounts/session";
import { acceptInvite, findInvite } from "@/lib/accounts/store";

// An invite link's form posts here: the token, and the new password twice.
// A good token creates the account (or resets the user's existing one) and
// signs the browser in; a bad one is charged to the client's address like a
// wrong password (lib/accounts/ratelimit.ts). Tokens are 256 random bits, so
// the limit is a second line, not the first.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const off = accountsOnly();
  if (off) return off;

  const form = await readForm(request);
  const token = field(form, "token");
  if (!tokenHash(token)) return seeOther("/login?error=invite");
  const page = `/invite/${token}`;
  const keys = failureKeys(requestIp(request));
  if (!checkAll(authFailures, keys).allowed) return seeOther(`${page}?error=throttled`);

  try {
    if (!(await findInvite(token))) {
      failAll(authFailures, keys);
      return seeOther(`${page}?error=invalid`);
    }
    const problem = newPasswordProblem(field(form, "password"), field(form, "confirm"));
    if (problem) return seeOther(`${page}?error=${problem}`);

    const result = await acceptInvite(token, await hashPassword(field(form, "password")));
    if (!result.ok) {
      if (result.reason === "invalid") failAll(authFailures, keys);
      return seeOther(`${page}?error=${result.reason}`);
    }
    const session = await createSession(result.accountId, {
      userAgent: request.headers.get("user-agent"),
      ip: requestIp(request),
    });
    return setSessionCookie(seeOther("/?notice=welcome"), session);
  } catch (e) {
    console.error("[puls-web] invite failed:", e instanceof Error ? e.message : e);
    return seeOther(`${page}?error=unavailable`);
  }
}
