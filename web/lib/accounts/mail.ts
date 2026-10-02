// What accounts mode emails, and to whom. Plain text, no tracking, no
// images. Only two kinds of message leave the viewer: notices to the
// operator (WEB_ADMIN_EMAIL), and an approved person's invite — which only
// an administrator's decision can send, so the public sign-up form cannot be
// used to mail a stranger.

import { mailConfig, sendMail } from "../email";

export const APP_STORE_URL = "https://apps.apple.com/us/app/pulshealth/id6757657354";

/** The viewer's public address, for links in email. */
export function publicBase(env = process.env): string {
  try {
    return new URL(env.WEB_PUBLIC_URL ?? "").origin;
  } catch {
    return "";
  }
}

// At most this many operator notices a day, however many requests arrive:
// a flood of sign-ups must not become a flood of email. Requests past the
// cap still wait on /admin.
const ADMIN_NOTICES_PER_DAY = 30;
const noticeLog: number[] = [];

function allowNotice(now = Date.now()): boolean {
  while (noticeLog.length && now - noticeLog[0] > 86_400_000) noticeLog.shift();
  if (noticeLog.length >= ADMIN_NOTICES_PER_DAY) return false;
  noticeLog.push(now);
  return true;
}

async function noticeToAdmin(subject: string, text: string, replyTo?: string): Promise<boolean> {
  const config = mailConfig();
  if (!config?.admin || !allowNotice()) return false;
  return sendMail({ to: config.admin, subject, text, replyTo }, config);
}

export function newRequestNotice(r: { name: string; email: string; note: string; ip: string | null }, base = publicBase()) {
  const who = r.name ? `${r.name} <${r.email}>` : r.email;
  return {
    subject: `PulsHealth: access request from ${r.name || r.email}`,
    text: [
      `${who} asked for an account on your PulsHealth viewer.`,
      "",
      r.note ? `They wrote:\n${r.note}\n` : "They left no note.\n",
      r.ip ? `From ${r.ip}.` : "",
      "",
      "Nothing exists for them until you approve: no account, no user, no way to sync.",
      `Approve or decline: ${base}/admin`,
    ]
      .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
      .join("\n"),
  };
}

export async function notifyNewRequest(r: { name: string; email: string; note: string; ip: string | null }): Promise<boolean> {
  const { subject, text } = newRequestNotice(r);
  return noticeToAdmin(subject, text, r.email);
}

export function approvalMessage(r: { name: string; email: string; inviteToken: string; days: number }, base = publicBase()) {
  return {
    subject: "Your PulsHealth access is approved",
    text: [
      `Hi${r.name ? ` ${r.name}` : ""},`,
      "",
      "Your request to use the PulsHealth viewer was approved.",
      "",
      `1. Choose a password (this link works once, for ${r.days} days):`,
      `   ${base}/invite/${r.inviteToken}`,
      "",
      `2. On your iPhone, install PulsHealth from the App Store: ${APP_STORE_URL}`,
      "",
      `3. Still on the iPhone, sign in at ${base}, open Account, and tap "Connect this iPhone".`,
      "   PulsHealth opens and asks you to confirm; then choose what to sync.",
      "",
      "Your records are visible to you alone in the viewer. They are stored on a",
      "server the PulsHealth developer runs; what that means is in the privacy",
      "policy: https://pulshealth.com/privacy",
      "",
      "If you did not ask for this, ignore this email; nothing happens unless the link is used.",
    ].join("\n"),
  };
}

export async function sendApproval(r: { name: string; email: string; inviteToken: string; days: number }): Promise<boolean> {
  const config = mailConfig();
  if (!config) return false;
  const { subject, text } = approvalMessage(r);
  return sendMail({ to: r.email, subject, text, replyTo: config.admin ?? undefined }, config);
}

export async function notifyDeletion(r: { email: string; userId: string }, base = publicBase()): Promise<boolean> {
  return noticeToAdmin(
    `PulsHealth: ${r.email} deleted their account`,
    [
      `${r.email} (user ${r.userId}) deleted their account on your viewer.`,
      "",
      "It is disabled and its sync tokens are revoked, so nothing more arrives.",
      `Their data is still stored until you purge it: ${base}/admin`,
    ].join("\n"),
  );
}
