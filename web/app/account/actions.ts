"use server";

import { currentAccount } from "@/lib/accounts/admin";
import { errorMessage } from "@/lib/accounts/messages";
import { issueDeviceToken, pairingLink } from "@/lib/accounts/signups";
import { qrSvg } from "@/lib/qr";

export type ConnectState = null | { ok: true; link: string; svg: string } | { ok: false; error: string };

/** Where phones sync to: WEB_INGEST_URL (Compose defaults it to PULS_PUBLIC_URL). */
function ingestUrl(): string | null {
  const raw = process.env.WEB_INGEST_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

// "Connect this iPhone" on the account page: mints a sync token for the
// signed-in person's own user (the database checks the session itself and
// will not mint for anyone else) and returns the pairing code — once. The
// token is never stored in plaintext, never put in a URL and never emailed;
// lose this page and you connect again, then disconnect the old one.
export async function connectIphone(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const account = await currentAccount();
  if (!account) return { ok: false, error: "Sign in again, then try once more." };
  if (account.demo) return { ok: false, error: errorMessage("demo")! };
  if (!account.selfService) return { ok: false, error: "Phones for this account are connected by the operator." };
  const url = ingestUrl();
  if (!url) return { ok: false, error: "The operator has not set this viewer's sync address (WEB_INGEST_URL), so there is nothing to connect to yet." };
  const name = String(form.get("name") ?? "").trim().slice(0, 100) || "iPhone";
  try {
    const { token } = await issueDeviceToken(account.id, name);
    const link = pairingLink(url, token, account.userId);
    return { ok: true, link, svg: qrSvg(link, { margin: 4, size: 240 }) };
  } catch (e) {
    if ((e as { code?: string }).code === "54000") return { ok: false, error: "You have ten connected iPhones already. Disconnect one first." };
    console.error("[puls-web] connect failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "That did not work. Try again in a moment." };
  }
}
