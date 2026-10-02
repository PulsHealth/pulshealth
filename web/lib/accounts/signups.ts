// Sign-up requests, the administrator's decisions, and a person's own phone
// and account (016_web_signups.sql). Everything that writes beyond schema
// auth goes through the SECURITY DEFINER functions there, each of which
// checks the caller's session token itself. Server-only.

import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";

import { query, transaction } from "../db";
import { newToken, tokenHash } from "./session";

/** How long an approval's invite link works. */
export const APPROVAL_INVITE_DAYS = 7;

export interface SignupInput {
  email: string;
  name: string;
  note: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Records a request. Asking again while one is pending changes nothing and
 * is not an error (the person sees the same confirmation either way, so the
 * form does not reveal who has asked). True when a new request was created.
 */
export async function createSignupRequest(input: SignupInput): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO auth.signup_requests (email, name, note, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) WHERE status = 'pending' DO NOTHING
     RETURNING id::text`,
    [
      input.email,
      input.name.slice(0, 200),
      input.note.slice(0, 2000),
      input.ip && isIP(input.ip) ? input.ip : null,
      input.userAgent?.slice(0, 300) ?? null,
    ],
  );
  return rows.length > 0;
}

/** Whether an account already signs in with this address. */
export async function accountExists(email: string): Promise<boolean> {
  const rows = await query("SELECT 1 FROM auth.accounts WHERE email = $1", [email]);
  return rows.length > 0;
}

export interface SignupRequest {
  id: string;
  email: string;
  name: string;
  note: string;
  status: "pending" | "approved" | "denied";
  createdAt: number;
  decidedAt: number | null;
  ip: string | null;
  userAgent: string | null;
}

export async function listSignupRequests(): Promise<SignupRequest[]> {
  // What the privacy policy promises: an approved request's details (note,
  // address, browser) go 30 days after the decision. Declined ones were
  // deleted when declined.
  await query("DELETE FROM auth.signup_requests WHERE status <> 'pending' AND decided_at < now() - interval '30 days'");
  const rows = await query<{
    id: string;
    email: string;
    name: string;
    note: string;
    status: SignupRequest["status"];
    created_at: Date;
    decided_at: Date | null;
    ip: string | null;
    user_agent: string | null;
  }>(
    `SELECT id::text, email, name, note, status, created_at, decided_at, host(ip) AS ip, user_agent
       FROM auth.signup_requests
      WHERE status = 'pending' OR decided_at > now() - interval '30 days'
      ORDER BY status = 'pending' DESC, created_at DESC
      LIMIT 200`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    note: r.note,
    status: r.status,
    createdAt: r.created_at.getTime(),
    decidedAt: r.decided_at?.getTime() ?? null,
    ip: r.ip,
    userAgent: r.user_agent,
  }));
}

export interface Approval {
  userId: string;
  email: string;
  name: string;
  /** The invite link's token, plaintext, for the approval email. */
  inviteToken: string;
}

/**
 * Approves a request: the database creates the person's user (checking the
 * administrator's session itself), and an invite for them goes in the same
 * transaction, so an approval never exists without its invite.
 */
export async function approveSignup(sessionToken: string, adminAccountId: string, requestId: string): Promise<Approval> {
  const inviteToken = newToken();
  return transaction(async (q) => {
    const [{ user_id: userId }] = await q<{ user_id: string }>(
      "SELECT auth.approve_signup($1, $2::uuid)::text AS user_id",
      [sessionToken, requestId],
    );
    const [request] = await q<{ email: string; name: string }>(
      "SELECT email, name FROM auth.signup_requests WHERE id = $1::uuid",
      [requestId],
    );
    await q(
      `INSERT INTO auth.invites (token_hash, user_id, email, created_by, expires_at)
       VALUES ($1, $2::uuid, $3, $4::uuid, now() + make_interval(days => $5))`,
      [tokenHash(inviteToken), userId, request.email, adminAccountId, APPROVAL_INVITE_DAYS],
    );
    return { userId, email: request.email, name: request.name, inviteToken };
  });
}

/** Declines a pending request by deleting it outright; true when one was. No email is sent. */
export async function denySignup(requestId: string): Promise<boolean> {
  const rows = await query("DELETE FROM auth.signup_requests WHERE id = $1::uuid AND status = 'pending' RETURNING 1", [requestId]);
  return rows.length > 0;
}

export interface AdminAccount {
  id: string;
  userId: string;
  email: string;
  isAdmin: boolean;
  createdAt: number;
  disabledAt: number | null;
  deletionRequestedAt: number | null;
  lastSeenAt: number | null;
}

export async function listAccounts(): Promise<AdminAccount[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    email: string;
    is_admin: boolean;
    created_at: Date;
    disabled_at: Date | null;
    deletion_requested_at: Date | null;
    last_seen_at: Date | null;
  }>(
    `SELECT a.id::text, a.user_id::text, a.email, a.is_admin, a.created_at, a.disabled_at,
            a.deletion_requested_at, max(s.last_seen_at) AS last_seen_at
       FROM auth.accounts a
       LEFT JOIN auth.sessions s ON s.account_id = a.id
      GROUP BY a.id
      ORDER BY a.deletion_requested_at IS NOT NULL DESC, a.created_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: r.email,
    isAdmin: r.is_admin,
    createdAt: r.created_at.getTime(),
    disabledAt: r.disabled_at?.getTime() ?? null,
    deletionRequestedAt: r.deletion_requested_at?.getTime() ?? null,
    lastSeenAt: r.last_seen_at?.getTime() ?? null,
  }));
}

export async function setAccountDisabled(sessionToken: string, accountId: string, disabled: boolean): Promise<void> {
  await query("SELECT auth.set_account_disabled($1, $2::uuid, $3)", [sessionToken, accountId, disabled]);
}

/** Deletes everything stored for the user; rows removed per table. */
export async function purgeUser(sessionToken: string, userId: string): Promise<Record<string, number>> {
  const [row] = await query<{ counts: Record<string, number> }>(
    "SELECT auth.purge_user($1, $2::uuid) AS counts",
    [sessionToken, userId],
  );
  return row.counts;
}

// ── the signed-in person's own phone and account ────────────────────────────

export interface DeviceToken {
  id: string;
  /** The plaintext, for the pairing code. Shown once; never stored. */
  token: string;
}

/**
 * Mints a sync token for the signed-in person's own user: 32 random bytes,
 * hex — the shape `ingest devices issue` makes — of which the database keeps
 * only the SHA-256 over the hex text, as ingest looks it up.
 */
export async function issueDeviceToken(sessionToken: string, name: string): Promise<DeviceToken> {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token, "ascii").digest();
  const [row] = await query<{ id: string }>(
    "SELECT auth.issue_device_token($1, $2, $3, $4)::text AS id",
    [sessionToken, hash, token.slice(0, 8), name.slice(0, 100)],
  );
  return { id: row.id, token };
}

export interface MyDevice {
  id: string;
  name: string;
  prefix: string;
  active: boolean;
  createdAt: number;
  lastSeenAt: number | null;
}

export async function myDevices(sessionToken: string): Promise<MyDevice[]> {
  const rows = await query<{
    id: string;
    name: string;
    token_prefix: string;
    status: string;
    created_at: Date;
    last_seen_at: Date | null;
  }>("SELECT id::text, name, token_prefix, status, created_at, last_seen_at FROM auth.my_devices($1)", [sessionToken]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.token_prefix,
    active: r.status === "active",
    createdAt: r.created_at.getTime(),
    lastSeenAt: r.last_seen_at?.getTime() ?? null,
  }));
}

export async function revokeMyDevice(sessionToken: string, id: string): Promise<boolean> {
  if (!/^\d{1,18}$/.test(id)) return false;
  const [row] = await query<{ revoked: boolean }>("SELECT auth.revoke_my_device($1, $2::bigint) AS revoked", [sessionToken, id]);
  return row.revoked;
}

/** Disables the caller's own account and revokes its tokens; the user id, for the operator's notice. */
export async function deleteMyAccount(sessionToken: string): Promise<string> {
  const [row] = await query<{ user_id: string }>("SELECT auth.delete_my_account($1)::text AS user_id", [sessionToken]);
  return row.user_id;
}

/** The pairing code for the app: the same payload ingest prints (pairing.go). */
export function pairingLink(serverUrl: string, token: string, userId: string): string {
  const escape = (s: string) =>
    Array.from(new TextEncoder().encode(s))
      .map((b) => {
        const c = String.fromCharCode(b);
        return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
      })
      .join("");
  return `puls://pair?url=${escape(serverUrl)}&token=${escape(token)}&user=${escape(userId)}`;
}
