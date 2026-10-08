// The account rows behind accounts mode (schema auth, 015_web_accounts.sql).
// Account identity lives here and never in `users`, whose name and email are
// the phone's HealthKit profile. Server-only.

import { query, transaction } from "../db";
import { revokeAllGrants } from "../oauth/store";
import { createSession, SESSION_ABSOLUTE_DAYS, tokenHash, type SessionMeta } from "./session";

/**
 * The stored form of an email address: trimmed and lower-cased (the table's
 * CHECK insists), or null for something that is not plausibly one.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? "").trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}

export interface LoginAccount {
  id: string;
  userId: string;
  passwordHash: string;
}

/** The account an email signs in, if it can sign in at all. */
export async function findAccountForLogin(email: string): Promise<LoginAccount | null> {
  const rows = await query<{ id: string; user_id: string; password_hash: string }>(
    `SELECT id::text, user_id::text, password_hash
       FROM auth.accounts
      WHERE email = $1 AND disabled_at IS NULL AND password_hash IS NOT NULL`,
    [email],
  );
  const row = rows[0];
  return row ? { id: row.id, userId: row.user_id, passwordHash: row.password_hash } : null;
}

/** What /demo needs to know about the account WEB_DEMO_USER names. */
export interface DemoAccount {
  id: string;
  disabled: boolean;
  hasPassword: boolean;
  isAdmin: boolean;
  /** Made by an approved sign-up, so the viewer's self-service may act on it. */
  selfService: boolean;
}

/** The demo user's account, whatever its state, or null when it has none. */
export async function findDemoAccount(userId: string): Promise<DemoAccount | null> {
  const rows = await query<{ id: string; disabled: boolean; has_password: boolean; is_admin: boolean; self_service: boolean }>(
    `SELECT a.id::text, a.disabled_at IS NOT NULL AS disabled, a.password_hash IS NOT NULL AS has_password, a.is_admin,
            EXISTS (SELECT 1 FROM auth.self_service_users ss WHERE ss.user_id = a.user_id) AS self_service
       FROM auth.accounts a
      WHERE a.user_id = $1`,
    [userId],
  );
  const row = rows[0];
  return row
    ? { id: row.id, disabled: row.disabled, hasPassword: row.has_password, isAdmin: row.is_admin, selfService: row.self_service }
    : null;
}

/**
 * Why the demo account cannot take visitors, or null when it can. It must
 * exist, be enabled and have a password hash (findSession wants one), and be
 * an operator-made, ordinary account: never an administrator, and never one
 * an approved sign-up made — the viewer's self-service functions may mint
 * sync tokens for those and purge them, and the database's own checks are
 * what keep the viewer away from the household's users.
 */
export function demoAccountProblem(account: DemoAccount | null): "missing" | "disabled" | "admin" | "self-service" | null {
  if (!account) return "missing";
  if (account.disabled || !account.hasPassword) return "disabled";
  if (account.isAdmin) return "admin";
  if (account.selfService) return "self-service";
  return null;
}

export async function findPasswordHash(accountId: string): Promise<string | null> {
  const rows = await query<{ password_hash: string | null }>(
    "SELECT password_hash FROM auth.accounts WHERE id = $1 AND disabled_at IS NULL",
    [accountId],
  );
  return rows[0]?.password_hash ?? null;
}

/**
 * Finishes a password login only while the verified credentials are still
 * current. The account lock serializes this with password changes, invite
 * resets and disabling: they either invalidate this attempt, or revoke the
 * session it creates. A legacy rehash cannot restore a replaced password.
 */
export async function finishPasswordLogin(
  account: LoginAccount,
  replacementHash: string | null,
  meta: SessionMeta,
  previousSession: Buffer | null,
): Promise<string | null> {
  return transaction(async (q) => {
    const rows = await q(
      "SELECT 1 FROM auth.accounts WHERE id = $1 AND password_hash = $2 AND disabled_at IS NULL FOR UPDATE",
      [account.id, account.passwordHash],
    );
    if (!rows.length) return null;
    if (replacementHash) {
      await q("UPDATE auth.accounts SET password_hash = $2 WHERE id = $1", [account.id, replacementHash]);
    }
    if (previousSession) await q("DELETE FROM auth.sessions WHERE id = $1", [previousSession]);
    return createSession(account.id, meta, q);
  });
}

/**
 * A new password: stored, and every session of the account ended — the
 * caller's too, which it replaces with a fresh one, so no copy of any cookie
 * survives a password change. Every AI assistant connected to the account
 * (OAuth grant) is revoked with them.
 */
export async function changePassword(accountId: string, hash: string): Promise<void> {
  await transaction(async (q) => {
    await q("UPDATE auth.accounts SET password_hash = $2, password_changed_at = now() WHERE id = $1", [accountId, hash]);
    await q("DELETE FROM auth.sessions WHERE account_id = $1", [accountId]);
    await revokeAllGrants(q, accountId);
  });
}

/** Rechecks the authorizing password and session, changes it and signs in atomically. */
export async function changePasswordAndSession(
  accountId: string,
  verifiedHash: string,
  sessionId: Buffer,
  newHash: string,
  meta: SessionMeta,
): Promise<string | null> {
  return transaction(async (q) => {
    const account = await q(
      "SELECT 1 FROM auth.accounts WHERE id = $1 AND password_hash = $2 AND disabled_at IS NULL FOR UPDATE",
      [accountId, verifiedHash],
    );
    if (!account.length) return null;
    // Check after acquiring the account lock: a reset that preceded this
    // request may have revoked its session even when the password is equal.
    const session = await q(
      `SELECT 1 FROM auth.sessions WHERE id = $1 AND account_id = $2
         AND expires_at > now() AND created_at > now() - make_interval(days => $3)
       FOR UPDATE`,
      [sessionId, accountId, SESSION_ABSOLUTE_DAYS],
    );
    if (!session.length) return null;
    await q("UPDATE auth.accounts SET password_hash = $2, password_changed_at = now() WHERE id = $1", [accountId, newHash]);
    await q("DELETE FROM auth.sessions WHERE account_id = $1", [accountId]);
    await revokeAllGrants(q, accountId);
    return createSession(accountId, meta, q);
  });
}

export interface PendingInvite {
  email: string;
  /** Whether accepting it resets an existing account's password. */
  resetsExisting: boolean;
  expiresAt: number;
}

/** The unused, unexpired invite a link's token names, or null. */
export async function findInvite(token: string): Promise<PendingInvite | null> {
  const hash = tokenHash(token);
  if (!hash) return null;
  const rows = await query<{ email: string; existing: boolean; expires_at: Date }>(
    `SELECT i.email,
            EXISTS (SELECT 1 FROM auth.accounts a WHERE a.user_id = i.user_id) AS existing,
            i.expires_at
       FROM auth.invites i
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
    [hash],
  );
  const row = rows[0];
  return row ? { email: row.email, resetsExisting: row.existing, expiresAt: row.expires_at.getTime() } : null;
}

export type AcceptInviteResult = { ok: true; accountId: string; sessionToken: string } | { ok: false; reason: "invalid" | "email_taken" };

/**
 * Uses an invite: creates the user's account with this password or, when the
 * user already has one, resets it (signing out all of its sessions and
 * revoking its AI assistants' grants). An
 * account disabled after the invite was issued stays disabled — the invite
 * reads as spent — while a newer invite re-enables it: disabling (by hand,
 * `UPDATE auth.accounts SET disabled_at = now()`) must not be undone by a
 * link that was already out. The invite is spent, and any other outstanding
 * invite for the same user is withdrawn. One transaction; the invite row is
 * locked, so a link pressed twice is used once. The replacement browser
 * session is created before that transaction commits, so later credential
 * changes cannot miss it when revoking sessions.
 */
export async function acceptInvite(token: string, passwordHash: string, meta: SessionMeta, previousSession: Buffer | null): Promise<AcceptInviteResult> {
  const hash = tokenHash(token);
  if (!hash) return { ok: false, reason: "invalid" };
  return transaction(async (q) => {
    const invites = await q<{ id: string; user_id: string; email: string; is_admin: boolean; created_at: Date }>(
      `SELECT id::text, user_id::text, email, is_admin, created_at
         FROM auth.invites
        WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [hash],
    );
    const invite = invites[0];
    if (!invite) return { ok: false, reason: "invalid" } as const;

    const taken = await q<{ user_id: string }>(
      "SELECT user_id::text FROM auth.accounts WHERE email = $1 AND user_id <> $2",
      [invite.email, invite.user_id],
    );
    if (taken.length) return { ok: false, reason: "email_taken" } as const;

    const existing = await q<{ id: string; disabled_since_invite: boolean }>(
      `SELECT id::text, disabled_at IS NOT NULL AND disabled_at >= $2 AS disabled_since_invite
         FROM auth.accounts WHERE user_id = $1 FOR UPDATE`,
      [invite.user_id, invite.created_at],
    );
    if (existing[0]?.disabled_since_invite) return { ok: false, reason: "invalid" } as const;
    let accountId: string;
    if (existing[0]) {
      accountId = existing[0].id;
      await q(
        `UPDATE auth.accounts
            SET email = $2, password_hash = $3, password_changed_at = now(),
                is_admin = is_admin OR $4, disabled_at = NULL
          WHERE id = $1`,
        [accountId, invite.email, passwordHash, invite.is_admin],
      );
      await q("DELETE FROM auth.sessions WHERE account_id = $1", [accountId]);
      await revokeAllGrants(q, accountId);
    } else {
      const created = await q<{ id: string }>(
        `INSERT INTO auth.accounts (user_id, email, password_hash, is_admin, password_changed_at)
         VALUES ($1, $2, $3, $4, now())
         RETURNING id::text`,
        [invite.user_id, invite.email, passwordHash, invite.is_admin],
      );
      accountId = created[0].id;
    }
    await q("UPDATE auth.invites SET accepted_at = now() WHERE id = $1", [invite.id]);
    await q(
      `UPDATE auth.invites SET expires_at = now()
        WHERE user_id = $1 AND accepted_at IS NULL AND id <> $2 AND expires_at > now()`,
      [invite.user_id, invite.id],
    );
    if (previousSession) await q("DELETE FROM auth.sessions WHERE id = $1", [previousSession]);
    // Keep the account lock until its replacement session exists. A later
    // password change or disable must revoke this session as well.
    const sessionToken = await createSession(accountId, meta, q);
    return { ok: true, accountId, sessionToken } as const;
  });
}
