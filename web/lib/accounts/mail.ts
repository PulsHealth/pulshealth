// What accounts mode emails, and to whom. Plain text, no tracking, no
// images. Only two kinds of message leave the viewer: notices to the
// operator (WEB_ADMIN_EMAIL), and an approved person's invite — which only
// an administrator's decision can send, so the public sign-up form cannot be
// used to mail a stranger.

import { mailConfig, sendMail } from "../email";
import type { Env } from "../mode";

export const APP_STORE_URL = "https://apps.apple.com/us/app/pulshealth/id6757657354";

/** The viewer's public address (WEB_PUBLIC_URL), for links in email; "" when unset. */
export function publicBase(env: Env = process.env): string {
  try {
    const url = new URL(env.WEB_PUBLIC_URL ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "";
  } catch {
    return "";
  }
}

// At most this many operator notices of each kind a day: a flood of
// sign-ups must not become a flood of email, nor crowd out the notice that
// someone deleted their account. Requests past the cap still wait on /admin.
export const NOTICES_PER_DAY = 30;

export class DailyCap {
  private log: number[] = [];
  constructor(private readonly limit: number) {}
  allow(now = Date.now()): boolean {
    while (this.log.length && now - this.log[0] > 86_400_000) this.log.shift();
    if (this.log.length >= this.limit) return false;
    this.log.push(now);
    return true;
  }
}

const requestNotices = new DailyCap(NOTICES_PER_DAY);
const deletionNotices = new DailyCap(NOTICES_PER_DAY);

async function noticeToAdmin(cap: DailyCap, subject: string, text: string, replyTo?: string): Promise<boolean> {
  const config = mailConfig();
  if (!config?.admin || !cap.allow()) return false;
  return sendMail({ to: config.admin, subject, text, replyTo }, config);
}

const adminLink = (base: string) => (base ? `${base}/admin` : "the viewer's /admin page");

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
      `Approve or decline: ${adminLink(base)}`,
    ]
      .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
      .join("\n"),
  };
}

export async function notifyNewRequest(r: { name: string; email: string; note: string; ip: string | null }): Promise<boolean> {
  const { subject, text } = newRequestNotice(r);
  return noticeToAdmin(requestNotices, subject, text, r.email);
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

/**
 * Emails an approved person their invite. False — nothing sent — without
 * mail configured or without WEB_PUBLIC_URL (the links would have no host);
 * the administrator is then shown the link to pass on.
 */
export async function sendApproval(r: { name: string; email: string; inviteToken: string; days: number }): Promise<boolean> {
  const config = mailConfig();
  const base = publicBase();
  if (!config || !base) return false;
  const { subject, text } = approvalMessage(r, base);
  return sendMail({ to: r.email, subject, text, replyTo: config.admin ?? undefined }, config);
}

export async function notifyDeletion(r: { email: string; userId: string }, base = publicBase()): Promise<boolean> {
  return noticeToAdmin(
    deletionNotices,
    `PulsHealth: ${r.email} requested account deletion`,
    [
      `${r.email} (user ${r.userId}) requested account deletion on your viewer.`,
      "",
      "It is disabled and its sync tokens are revoked, so nothing more arrives.",
      `Their data is still stored until you purge it: ${adminLink(base)}`,
    ].join("\n"),
  );
}
