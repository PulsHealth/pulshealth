import type { NextRequest } from "next/server";
import { accountsOnly, clearSessionCookie, field, readForm, requestIp, seeOther } from "@/lib/accounts/http";
import { hashPassword, newPasswordProblem } from "@/lib/accounts/password";
import { completePasswordReset, usablePasswordReset } from "@/lib/accounts/recovery";
import { authFailures, failureKeys, refundAll, takeAll } from "@/lib/accounts/ratelimit";
import { tokenHash } from "@/lib/accounts/session";

export async function POST(request: NextRequest) {
  const off = accountsOnly();
  if (off) return off;
  const form = await readForm(request);
  const token = field(form, "token");
  if (!tokenHash(token)) return seeOther("/forgot-password");
  const page = `/reset-password/${token}`;
  const keys = failureKeys(requestIp(request));
  if (!takeAll(authFailures, keys).allowed) return seeOther(`${page}?error=throttled`);
  try {
    if (!(await usablePasswordReset(token))) return seeOther(`${page}?error=invalid`);
    const problem = newPasswordProblem(field(form, "password"), field(form, "confirm"));
    if (problem) {
      refundAll(authFailures, keys);
      return seeOther(`${page}?error=${problem}`);
    }
    if (!(await completePasswordReset(token, await hashPassword(field(form, "password"))))) return seeOther(`${page}?error=invalid`);
    refundAll(authFailures, keys);
    return clearSessionCookie(seeOther("/login?notice=recovered"));
  } catch {
    refundAll(authFailures, keys);
    console.error("[puls-web] password reset unavailable");
    return seeOther(`${page}?error=unavailable`);
  }
}
