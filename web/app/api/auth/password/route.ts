import type { NextRequest } from "next/server";

import { accountsOnly, field, readForm, requestIp, requestSession, seeOther } from "@/lib/accounts/http";
import { hashPassword, newPasswordProblem, verifyPassword } from "@/lib/accounts/password";
import { authFailures, checkAll, failAll, failureKeys } from "@/lib/accounts/ratelimit";
import { changePassword, findPasswordHash } from "@/lib/accounts/store";

// The account page's "Change password" form. It needs the current password
// as well as the session — a borrowed, unlocked browser should not be enough
// to take the account over — and a wrong one is charged like a failed
// sign-in. A change signs out every other session of the account.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const off = accountsOnly();
  if (off) return off;
  const session = await requestSession(request);
  if (!session) return seeOther("/login?next=%2Faccount");

  const form = await readForm(request);
  const keys = [...failureKeys(requestIp(request)), `account:${session.accountId}`];
  if (!checkAll(authFailures, keys).allowed) return seeOther("/account?error=throttled");

  const password = field(form, "password");
  const problem = newPasswordProblem(password, field(form, "confirm"));
  if (problem) return seeOther(`/account?error=${problem}`);

  try {
    const current = await findPasswordHash(session.accountId);
    if (!current || !(await verifyPassword(field(form, "current"), current))) {
      failAll(authFailures, keys);
      return seeOther("/account?error=current");
    }
    await changePassword(session.accountId, await hashPassword(password), session.id);
    return seeOther("/account?notice=password");
  } catch (e) {
    console.error("[puls-web] password change failed:", e instanceof Error ? e.message : e);
    return seeOther("/account?error=unavailable");
  }
}
