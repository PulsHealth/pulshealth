"use server";

import { currentAccount } from "@/lib/accounts/admin";
import { connectPhone } from "@/lib/accounts/connect";
import { qrSvg } from "@/lib/qr";

export type ConnectState = null | { ok: true; link: string; svg: string } | { ok: false; error: string };

// The browser account page can also pair a phone by link or QR code.
export async function connectIphone(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const result = await connectPhone(await currentAccount(), String(form.get("name") ?? ""));
  return result.ok ? { ...result, svg: qrSvg(result.link, { margin: 4, size: 240 }) } : { ok: false, error: result.error };
}
