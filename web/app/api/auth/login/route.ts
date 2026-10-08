import type { NextRequest } from "next/server";

import { accountsOnly, field, readForm, requestIp, seeOther, setSessionCookie } from "@/lib/accounts/http";
import { burnPasswordCheck, hashPassword, needsRehash, PASSWORD_MAX_LENGTH, verifyPassword } from "@/lib/accounts/password";
import { authFailures, checkAll, failureKeys, refundAll, takeAll } from "@/lib/accounts/ratelimit";
import { SESSION_COOKIE, signedInFrom, tokenHash } from "@/lib/accounts/session";
import { findAccountForLogin, finishPasswordLogin, normalizeEmail } from "@/lib/accounts/store";
import { safeReturnPath } from "@/lib/viewer";

// The sign-in form posts here (accounts mode). proxy.ts has already refused
// plain HTTP and cross-site posts. Every outcome is a 303: back to /login
// with an error code, or on to `next` with a new session cookie.
//
// Each attempt takes a token from the client address's bucket and the
// email's before the password is looked at, and gets it back only if it
// succeeds (lib/accounts/ratelimit.ts) — so only failures cost, an exhausted
// bucket is refused before the password is checked, and parallel guesses
// cannot all slip past the check while the first is still being verified.
// From an address one of the account's live sessions signed in from, the
// email's bucket is not charged (or consulted): strangers exhausting it
// cannot lock the owner out from where they already sign in. Which buckets
// apply is settled by one lookup before the take; the take itself stays one
// synchronous step.
// An unknown email costs the same scrypt as a known one, so timing does not
// reveal which addresses have accounts, and the error never says which half
// was wrong. Nothing about a failed attempt is logged.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const off = accountsOnly();
  if (off) return off;

  const form = await readForm(request);
  const next = safeReturnPath(field(form, "next"));
  const back = (error: string) =>
    seeOther(`/login?error=${error}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`);

  const email = normalizeEmail(field(form, "email"));
  const password = field(form, "password");
  const ip = requestIp(request);
  const keys = await chargeableKeys(ip, email);
  if (!takeAll(authFailures, keys).allowed) return back("throttled");
  // From here, returning without a refund records a failure.
  if (!email || !password || password.length > PASSWORD_MAX_LENGTH * 4) return back("invalid");

  try {
    const account = await findAccountForLogin(email);
    if (!account) {
      await burnPasswordCheck(password);
      return back("invalid");
    }
    if (!(await verifyPassword(password, account.passwordHash))) return back("invalid");
    const replacementHash = needsRehash(account.passwordHash) ? await hashPassword(password) : null;

    // A new session id on every sign-in; the one this browser held, if any,
    // is retired so a planted cookie cannot ride into the signed-in session.
    const previous = tokenHash(request.cookies.get(SESSION_COOKIE)?.value);
    const token = await finishPasswordLogin(account, replacementHash, {
      userAgent: request.headers.get("user-agent"),
      ip,
    }, previous);
    if (!token) return back("invalid");
    refundAll(authFailures, keys);
    return setSessionCookie(seeOther(next), token);
  } catch (e) {
    // The server's fault, not a wrong guess.
    refundAll(authFailures, keys);
    console.error("[puls-web] sign-in failed:", e instanceof Error ? e.message : e);
    return back("unavailable");
  }
}

// The buckets this attempt answers to. The database is asked about the
// address only when the email's bucket is what would refuse it and the
// address's own still has room, so an attacker out of tokens costs no
// query; a failed lookup is not a known address.
async function chargeableKeys(ip: string, email: string | null): Promise<string[]> {
  const keys = failureKeys(ip, email ?? undefined);
  if (!email || checkAll(authFailures, keys).allowed || !checkAll(authFailures, failureKeys(ip)).allowed) return keys;
  const known = await signedInFrom(email, ip).catch(() => false);
  return failureKeys(ip, email, known);
}
