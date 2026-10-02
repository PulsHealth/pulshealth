import type { NextRequest } from "next/server";

import { accountsOnly, clearSessionCookie, field, readForm, requestSession, seeOther } from "@/lib/accounts/http";
import { notifyDeletion } from "@/lib/accounts/mail";
import { deleteMyAccount } from "@/lib/accounts/signups";

// "Delete my account": the account is disabled, its sessions end and its
// iPhones are disconnected at once (in the database, one transaction), and
// the operator is told to purge the stored data from /admin. Needs the box
// ticked; only for self-service accounts (household accounts are the
// operator's to remove), never administrators.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const off = accountsOnly();
  if (off) return off;
  const session = await requestSession(request);
  if (!session) return seeOther("/login?next=%2Faccount");
  if (session.isAdmin || !session.selfService) return seeOther("/account?error=forbidden");
  const form = await readForm(request);
  if (field(form, "confirm") !== "yes") return seeOther("/account?error=failed");
  try {
    const userId = await deleteMyAccount(session.id);
    await notifyDeletion({ email: session.email, userId });
    return clearSessionCookie(seeOther("/login?notice=deleted"));
  } catch (e) {
    console.error("[puls-web] account deletion failed:", e instanceof Error ? e.message : e);
    return seeOther("/account?error=failed");
  }
}
