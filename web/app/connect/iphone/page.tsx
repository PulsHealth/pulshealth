import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AuthCard } from "@/components/AuthCard";
import { errorMessage, param } from "@/lib/accounts/messages";
import { viewerMode } from "@/lib/mode";
import { currentSession } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect this iPhone — PulsHealth" };
type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ConnectPage({ searchParams }: { searchParams: Search }) {
  if (viewerMode() !== "accounts") notFound();
  const session = await currentSession();
  const login = "/login?next=%2Fconnect%2Fiphone";
  if (!session) redirect(login);
  const search = await searchParams;
  if (session.demo) {
    return <AuthCard title="Connect your own account" subtitle="The demo shows sample data. Sign in to your own account to sync this iPhone.">
      <a className="btn btn-primary btn-block" href={login}>Sign in to your account</a>
    </AuthCard>;
  }
  return <AuthCard title="Connect this iPhone" subtitle={<>Signed in as {session.email}.</>}
    error={errorMessage(param(search.error), { sync_address: "This database’s sync address has not been configured. Contact the person who runs it." })}>
    <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.55 }}>
      Connect this iPhone to your PulsHealth database. You will return to the app to review the connection and tap Save &amp; Apply before Health data is uploaded.
    </p>
    <form method="post" action="/api/auth/connect-iphone">
      <input type="hidden" name="name" value="iPhone" />
      <button type="submit" className="btn btn-primary btn-block">Connect this iPhone</button>
    </form>
    <form method="post" action="/api/auth/logout" style={{ marginTop: 16 }}>
      <button type="submit" className="btn">Sign out to use a different account</button>
    </form>
  </AuthCard>;
}
