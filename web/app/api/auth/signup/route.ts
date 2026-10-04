import { NextResponse, type NextRequest } from "next/server";

import { field, readForm, requestIp, seeOther } from "@/lib/accounts/http";
import { notifyNewRequest } from "@/lib/accounts/mail";
import { signupRequests, takeAll } from "@/lib/accounts/ratelimit";
import { accountExists, createSignupRequest, SIGNUP_PENDING_CAP } from "@/lib/accounts/signups";
import { normalizeEmail } from "@/lib/accounts/store";
import { signupsOpen } from "@/lib/mode";

// The sign-up form posts here. It records a request and emails the
// operator; it creates no user, account or token, and emails no one else, so
// the form can neither open the database to anyone nor be used to mail a
// stranger. The answer is the same whether or not the address already has
// an account or a pending request, so the form does not reveal who uses the
// viewer. Three requests an hour per client address; a filled-in honeypot
// gets the same answer and is dropped, and so does a request made while
// SIGNUP_PENDING_CAP requests already wait (the operator is told in the
// server log, at most once an hour, never with an address).
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!signupsOpen()) {
    return new NextResponse("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const form = await readForm(request);
  const done = seeOther("/signup?notice=received");
  if (field(form, "website")) return done;

  const email = normalizeEmail(field(form, "email"));
  if (!email) return seeOther("/signup?error=email");
  if (field(form, "consent") !== "yes") return seeOther("/signup?error=consent");
  if (!takeAll(signupRequests, [`ip:${requestIp(request)}`]).allowed) return seeOther("/signup?error=throttled");

  const name = field(form, "name").trim();
  const note = field(form, "note").trim();
  try {
    if (await accountExists(email)) return done;
    const ip = requestIp(request);
    const outcome = await createSignupRequest({ email, name, note, ip, userAgent: request.headers.get("user-agent") });
    // Not awaited: the answer must not take longer for a new address than
    // for one that already has an account, or its timing would tell them apart.
    if (outcome === "created") void notifyNewRequest({ name, email, note, ip: /^[0-9a-f.:]+$/i.test(ip) ? ip : null }).catch(() => {});
    if (outcome === "full") warnQueueFull();
    return done;
  } catch (e) {
    console.error("[puls-web] sign-up request failed:", e instanceof Error ? e.message : e);
    return seeOther("/signup?error=unavailable");
  }
}

// Once an hour at most per process, so a flood cannot flood the log too.
const QUEUE_FULL_WARN_MS = 60 * 60_000;
const queueFull = globalThis as typeof globalThis & { __pulsSignupQueueFullAt?: number };

function warnQueueFull(now = Date.now()): void {
  if (queueFull.__pulsSignupQueueFullAt !== undefined && now - queueFull.__pulsSignupQueueFullAt < QUEUE_FULL_WARN_MS) return;
  queueFull.__pulsSignupQueueFullAt = now;
  console.warn(
    `[puls-web] ${SIGNUP_PENDING_CAP} sign-up requests are waiting, so new ones are dropped (the form still says ` +
      "received). Decide or decline them on /admin; undecided requests are deleted after 30 days.",
  );
}
