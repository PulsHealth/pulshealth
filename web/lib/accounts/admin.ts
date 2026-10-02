// Who may use /admin, and the session token the database functions need to
// check that for themselves. Server-only.

import { cookies } from "next/headers";

import { viewerMode } from "../mode";
import { currentSession } from "../viewer";
import { SESSION_COOKIE, type Session } from "./session";

/** The signed-in administrator and their session token, or null. */
export async function currentAdmin(): Promise<{ session: Session; token: string } | null> {
  if (viewerMode() !== "accounts") return null;
  const session = await currentSession().catch(() => null);
  if (!session?.isAdmin) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? { session, token } : null;
}

/** The signed-in person (any account) and their session token, or null. */
export async function currentAccount(): Promise<{ session: Session; token: string } | null> {
  if (viewerMode() !== "accounts") return null;
  const session = await currentSession().catch(() => null);
  if (!session) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? { session, token } : null;
}
