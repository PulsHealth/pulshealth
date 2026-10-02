import type { NextRequest } from "next/server";

import { accountsOnly, field, readForm, requestSession, seeOther } from "@/lib/accounts/http";
import { denySignup, purgeUser, setAccountDisabled } from "@/lib/accounts/signups";

// The administrator's forms on /admin, other than Approve (a server action,
// so the invite link can come back once when email fails): decline a
// request (it is deleted, not kept), disable or enable an account, purge a
// disabled user's data. The
// session must be an administrator's; the database checks that again for
// everything beyond schema auth.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const off = accountsOnly();
  if (off) return off;
  const session = await requestSession(request);
  if (!session?.isAdmin) return seeOther("/admin?error=forbidden");

  const form = await readForm(request);
  const action = field(form, "action");
  const id = field(form, "id");
  if (!UUID.test(id)) return seeOther("/admin?error=failed");
  try {
    switch (action) {
      case "deny":
        await denySignup(id);
        return seeOther("/admin?notice=denied");
      case "disable":
        await setAccountDisabled(session.id, id, true);
        return seeOther("/admin?notice=disabled");
      case "enable":
        await setAccountDisabled(session.id, id, false);
        return seeOther("/admin?notice=enabled");
      case "purge":
        if (field(form, "confirm") !== "yes") return seeOther("/admin?error=failed");
        await purgeUser(session.id, id);
        return seeOther("/admin?notice=purged");
      default:
        return seeOther("/admin?error=failed");
    }
  } catch (e) {
    if (action === "enable" && (e as { code?: string }).code === "55000") return seeOther("/admin?error=deletion_requested");
    console.error(`[puls-web] admin ${action} failed:`, e instanceof Error ? e.message : e);
    return seeOther("/admin?error=failed");
  }
}
