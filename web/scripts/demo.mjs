#!/usr/bin/env node
// Creates the viewer account behind the public demo (accounts mode,
// WEB_DEMO_USER; see web/README.md, "Demo account").
//
//   docker compose exec web node scripts/demo.mjs --user <uuid> [--email demo@demo.invalid]
//   make web-demo ARGS='--user <uuid> [--email demo@demo.invalid]'
//
// The user must already exist and hold only sample data: create it with
// `make issue-device NAME='Demo data' ARGS='--user <uuid>'`, which also
// gives the loader its sync token. Never the household's own user, and
// never one an approved sign-up made — anyone on the internet can open the
// demo, and the viewer's self-service may act on sign-up users.
//
// The account gets the email (by default demo@demo.invalid: .invalid is a
// reserved top-level domain, so nothing can ever mail it) and a password
// hash of 32 random bytes that are thrown away at once: no password signs
// in to it, but it has the hash the viewer's session lookup requires. Visitors
// reach it only through /demo. Run it again and it reports the account
// instead of making a second one.
//
// Connects with the container's DATABASE_URL — in accounts mode, the web_app
// role, which may write auth.accounts and nothing that holds health data.

import { randomBytes, scrypt } from "node:crypto";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The user 000_users.sql seeds and the app ships with (lib/config.ts DEFAULT_USER_ID).
const SEEDED_USER = "5ea4d000-0000-4000-8000-000000000001";

export const DEFAULT_DEMO_EMAIL = "demo@demo.invalid";
export const USAGE = "usage: node scripts/demo.mjs --user <uuid> [--email demo@demo.invalid]";

/** Parsed options, or { error } with a message for the operator. */
export function parseArgs(argv, env = {}) {
  const options = { user: null, email: DEFAULT_DEMO_EMAIL };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    try {
      if (arg === "--user") options.user = value();
      else if (arg === "--email") options.email = value();
      else if (arg === "--help" || arg === "-h") return { help: true };
      else return { error: `unknown argument: ${arg}` };
    } catch (e) {
      return { error: e.message };
    }
  }
  if (!options.user || !UUID.test(options.user)) return { error: "--user must be the demo user's UUID" };
  options.user = options.user.toLowerCase();
  const household = [SEEDED_USER, String(env.PULS_USER_ID ?? "").trim().toLowerCase()];
  if (household.includes(options.user)) {
    return { error: "that is the household's default user (PULS_USER_ID); the demo must be a user that holds only sample data" };
  }
  const email = normalizeEmail(options.email);
  if (!email) return { error: "--email must be an email address" };
  options.email = email;
  return { options };
}

/** Same rule as lib/accounts/store.ts normalizeEmail. */
export function normalizeEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * A hash in lib/accounts/password.ts's format and parameters
 * (scrypt$N$r$p$<salt>$<key>) of 32 random bytes nobody keeps: it verifies
 * no password anyone can type.
 */
export async function unusableHash() {
  const N = 2 ** 16, r = 8, p = 2;
  const secret = randomBytes(32).toString("base64url");
  const salt = randomBytes(32);
  const key = await new Promise((resolve, reject) =>
    scrypt(secret, salt, 32, { N, r, p, maxmem: 256 * r * (N + p) }, (err, k) => (err ? reject(err) : resolve(k))),
  );
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Why an existing account cannot be the demo (lib/accounts/store.ts demoAccountProblem), or null. */
export function demoProblem(row) {
  if (row.disabled || !row.has_password) return "it is disabled, or has no password hash";
  if (row.is_admin) return "it is an administrator's account";
  if (row.self_service) return "an approved sign-up made this user";
  return null;
}

function printSetup(user) {
  console.log("Put this in server/.env, then `docker compose up -d web`:\n");
  console.log(`  WEB_DEMO_USER=${user}\n`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), process.env);
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  if (parsed.error) {
    console.error(`demo: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { user, email } = parsed.options;
  if (!process.env.DATABASE_URL) {
    console.error("demo: DATABASE_URL is not set (run this inside the web container: docker compose exec web …)");
    return 1;
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const selfService = await client.query("SELECT 1 FROM auth.self_service_users WHERE user_id = $1", [user]);
    const existing = await client.query(
      `SELECT id::text, email, is_admin, disabled_at IS NOT NULL AS disabled, password_hash IS NOT NULL AS has_password
         FROM auth.accounts WHERE user_id = $1`,
      [user],
    );
    if (existing.rowCount) {
      const row = { ...existing.rows[0], self_service: selfService.rowCount > 0 };
      const problem = demoProblem(row);
      console.log(`User ${user} already has a viewer account, ${row.email}.`);
      if (problem) {
        console.error(`demo: it cannot be the demo: ${problem}. Use a user created only for sample data.`);
        return 1;
      }
      console.log("It can be the demo (/demo refuses it otherwise when a visitor arrives).");
      printSetup(user);
      return 0;
    }
    if (selfService.rowCount) {
      console.error("demo: an approved sign-up made this user, and the viewer's self-service may act on it. Use a user created only for sample data.");
      return 1;
    }
    const taken = await client.query("SELECT user_id::text FROM auth.accounts WHERE email = $1", [email]);
    if (taken.rowCount) {
      console.error(`demo: ${email} already signs in another user's account (${taken.rows[0].user_id}); pass a different --email.`);
      return 1;
    }
    await client.query("INSERT INTO auth.accounts (user_id, email, password_hash) VALUES ($1, $2, $3)", [
      user,
      email,
      await unusableHash(),
    ]);
    console.log(`Demo account created for user ${user} (${email}). No password signs in to it; /demo does.`);
    printSetup(user);
    return 0;
  } catch (e) {
    if (e && e.code === "23503") {
      console.error(
        `demo: there is no user ${user} in the database yet. Create it first ` +
          "(make issue-device NAME='Demo data' ARGS='--user <uuid>'), which also gives the sample-data loader its token.",
      );
      return 1;
    }
    if (e && e.code === "23505") {
      console.error("demo: an account for this user or address appeared meanwhile; run this again to see it.");
      return 1;
    }
    if (e && e.code === "42501") {
      console.error("demo: this database role may not write accounts. The web container must connect as web_app (accounts mode).");
      return 1;
    }
    if (e && e.code === "3F000") {
      console.error("demo: the database has no `auth` schema yet; run the migrate service (docker compose up -d).");
      return 1;
    }
    throw e;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error("demo: failed:", e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
