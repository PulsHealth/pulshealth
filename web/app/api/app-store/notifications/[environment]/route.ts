import { VerificationException, VerificationStatus } from "@apple/app-store-server-library";
import { alertFor, deliverAlert } from "@/lib/appStore/alerts";
import { verifierFor } from "@/lib/appStore/verify";
import { mailConfig } from "@/lib/email";
import { viewerMode } from "@/lib/mode";

export const runtime = "nodejs";
const MAX_BODY = 128 * 1024;
const answer = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, context: { params: Promise<{ environment: string }> }): Promise<Response> {
  const { environment } = await context.params;
  if (!["production", "sandbox"].includes(environment) || viewerMode() !== "accounts" || !process.env.WEB_APP_STORE_ALERT_TO?.trim()) return answer(404);
  if (!mailConfig()) return answer(503);
  let signedPayload: string;
  try {
    if (!request.body) return answer(400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) { await reader.cancel(); return answer(413); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof body.signedPayload !== "string" || !body.signedPayload) return answer(400);
    signedPayload = body.signedPayload;
  } catch { return answer(400); }
  try {
    const sandbox = environment === "sandbox";
    const verifier = verifierFor(sandbox);
    const notification = await verifier.verifyAndDecodeNotification(signedPayload);
    const signedTransaction = notification.data?.signedTransactionInfo;
    const transaction = signedTransaction ? await verifier.verifyAndDecodeTransaction(signedTransaction) : null;
    const alert = alertFor(notification, transaction, sandbox);
    if (alert) await deliverAlert(alert);
    return answer(200);
  } catch (error) {
    // No payload, receipt, transaction identifier or email address in logs.
    if (error instanceof VerificationException && error.status !== VerificationStatus.RETRYABLE_VERIFICATION_FAILURE && error.status !== VerificationStatus.FAILURE) return answer(400);
    console.error("[puls-web] App Store alert temporarily unavailable");
    return answer(503);
  }
}
