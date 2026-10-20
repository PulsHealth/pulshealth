// Server-only. Apple's signed events never change app access or health records.
import { createHash } from "node:crypto";
import type { JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload } from "@apple/app-store-server-library";
import { transaction } from "../db";
import { mailConfig, sendMail } from "../email";

export const PRODUCTS: Record<string, string> = {
  "com.pulsHealth.PulsHealth.pro.monthly": "Pro Monthly",
  "com.pulsHealth.PulsHealth.pro.annual": "Pro Yearly",
  "com.pulsHealth.PulsHealth.pro.lifetime": "Pro Lifetime",
};
export const MAX_EVENT_AGE = 30 * 86_400_000;
export interface Alert { key: Buffer; subject: string; text: string }

/** Only verified payloads may enter here. No buyer identity or receipt in mail. */
export function alertFor(n: ResponseBodyV2DecodedPayload, t: JWSTransactionDecodedPayload | null, sandbox: boolean, now = Date.now()): Alert | null {
  if (!n.notificationUUID || !n.signedDate || n.signedDate < now - MAX_EVENT_AGE || n.signedDate > now + 300_000) return null;
  const type = n.notificationType;
  const test = type === "TEST";
  if (sandbox && !test) return null; // TestFlight and sandbox never look like revenue.
  const product = t?.productId ? PRODUCTS[t.productId] : undefined;
  if (!test && (!t?.transactionId || !product || t.inAppOwnershipType !== "PURCHASED")) return null;
  let title: string;
  switch (type) {
    case "TEST": title = "App Store alert delivery test"; break;
    case "SUBSCRIBED": title = t?.price === 0 ? "Free subscription started" : "Subscription started"; break;
    case "DID_RENEW": title = t?.price === 0 ? "Free subscription renewed" : "Subscription renewed"; break;
    case "ONE_TIME_CHARGE": title = t?.price === 0 ? "Free Lifetime activation" : "Lifetime purchase"; break;
    case "REFUND": title = "Purchase refunded"; break;
    case "DID_FAIL_TO_RENEW": title = "Subscription billing problem"; break;
    case "DID_CHANGE_RENEWAL_STATUS":
      if (n.subtype !== "AUTO_RENEW_DISABLED") return null;
      title = "Subscription auto-renew turned off"; break;
    case "EXPIRED": title = "Subscription expired"; break;
    default: return null;
  }
  // Separate notifications for a Family Sharing beneficiary aren't sales.
  // Event kind/subtype distinguish a refund from the original purchase.
  const identity = `${sandbox ? "sandbox" : "production"}|${type}|${n.subtype ?? ""}|${test ? n.notificationUUID : t!.transactionId}`;
  const key = createHash("sha256").update(identity).digest();
  let amount = "Amount unavailable";
  if (t?.price !== undefined && Number.isFinite(t.price) && t.currency && /^[A-Z]{3}$/.test(t.currency)) {
    // Apple reports milliunits, not cents. Price is customer price, not proceeds.
    amount = new Intl.NumberFormat("en-US", { style: "currency", currency: t.currency }).format(t.price / 1000);
  }
  const prefix = sandbox ? "[SANDBOX] " : "";
  return {
    key,
    subject: `${prefix}PulsHealth: ${title}`,
    text: [
      `${prefix}${title}`, "", ...(product ? [`Plan: ${product}`] : []),
      `Event time (UTC): ${new Date(n.signedDate).toISOString()}`,
      ...(test ? ["This is a delivery test. No customer purchase or revenue is involved."] : [
        `Associated transaction price: ${amount}`,
        "This is the transaction's customer price, not your net earnings or a new charge for billing, cancellation, expiry or refund events.",
        ...(n.subtype === "AUTO_RENEW_DISABLED" ? ["Access continues through the paid period; this does not mean an immediate refund."] : []),
      ]), "", "View subscriptions, proceeds and payouts in App Store Connect:", "https://appstoreconnect.apple.com/",
    ].join("\n"),
  };
}

/** The row lock serializes parallel retries. Failed sends roll back for Apple to retry. */
export async function deliverAlert(alert: Alert): Promise<void> {
  const config = mailConfig();
  const to = process.env.WEB_APP_STORE_ALERT_TO?.trim();
  if (!config || !to) throw new Error("App Store alert mail is not configured");
  await transaction(async q => {
    await q("DELETE FROM auth.app_store_alerts WHERE created_at < now() - interval '90 days'");
    await q("INSERT INTO auth.app_store_alerts(event_hash) VALUES ($1) ON CONFLICT DO NOTHING", [alert.key]);
    const rows = await q<{ sent_at: Date | null }>("SELECT sent_at FROM auth.app_store_alerts WHERE event_hash = $1 FOR UPDATE", [alert.key]);
    if (rows[0].sent_at) return;
    if (!await sendMail({ to, subject: alert.subject, text: alert.text }, config)) throw new Error("App Store alert send failed");
    await q("UPDATE auth.app_store_alerts SET sent_at = now() WHERE event_hash = $1", [alert.key]);
  });
}
