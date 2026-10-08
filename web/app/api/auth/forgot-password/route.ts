import { after, type NextRequest } from "next/server";
import { accountsOnly, field, readForm, requestIp, seeOther } from "@/lib/accounts/http";
import { recoveryAvailable, requestPasswordReset, sendPasswordReset } from "@/lib/accounts/recovery";
import { normalizeEmail } from "@/lib/accounts/store";

export async function POST(request: NextRequest) {
  const off = accountsOnly();
  if (off) return off;
  const form = await readForm(request);
  const email = normalizeEmail(field(form, "email"));
  const ip = requestIp(request);
  // Account lookup and delivery happen after the identical response, preventing
  // both content and SES delivery timing from disclosing account existence.
  if (email && recoveryAvailable()) after(async () => {
    try {
      const reset = await requestPasswordReset(email, ip);
      if (reset) await sendPasswordReset(reset);
    } catch {
      console.error("[puls-web] password recovery unavailable");
    }
  });
  return seeOther("/forgot-password?sent=1");
}
