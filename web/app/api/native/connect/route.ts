import { NextResponse, type NextRequest } from "next/server";
import { accountsOnly } from "@/lib/accounts/http";
import { findSession } from "@/lib/accounts/session";
import { connectPhone } from "@/lib/accounts/connect";

export const dynamic = "force-dynamic";
const answer = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Explicit native account action. Cookies and caller-supplied user IDs never authorize pairing. */
export async function POST(request: NextRequest) {
  const off = accountsOnly();
  if (off) return off;
  try {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    const session = token ? await findSession(token, true) : null;
    if (!session || session.demo) return answer(401, { error: "Sign in to your personal account again." });
    const result = await connectPhone(session, "iPhone");
    if (!result.ok) return answer(409, { error: result.error });
    return answer(200, { link: result.link });
  } catch {
    return answer(503, { error: "Your server could not be reached. Try again." });
  }
}
