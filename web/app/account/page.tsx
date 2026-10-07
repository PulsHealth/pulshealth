import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";

import { ConnectIphone } from "@/components/ConnectIphone";
import { PageHeader } from "@/components/PageHeader";
import { errorMessage, noticeMessage, param } from "@/lib/accounts/messages";
import { PASSWORD_MIN_LENGTH } from "@/lib/accounts/password";
import { myDevices } from "@/lib/accounts/signups";
import { formatFull } from "@/lib/format";
import { DEMO_SESSION_HOURS, listSessions } from "@/lib/accounts/session";
import { signupsOpen, viewerMode } from "@/lib/mode";
import { oauthConfig } from "@/lib/oauth/config";
import { listConnectedApps } from "@/lib/oauth/store";
import { currentSession } from "@/lib/viewer";

// The signed-in person's own account (accounts mode only): connect an iPhone
// (and disconnect one), see and revoke the AI assistants connected over
// OAuth, change the password, see where the account is signed in and sign
// those browsers out, and delete the account. The shared demo account
// (WEB_DEMO_USER) gets none of that — only what it is and the way out; its
// routes refuse every change anyway (lib/accounts/http.ts refuseDemo).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account — PulsHealth" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountPage({ searchParams }: { searchParams: Search }) {
  if (viewerMode() !== "accounts") notFound();
  const session = await currentSession();
  if (!session) redirect("/login?next=%2Faccount");
  const search = await searchParams;
  const returnToApp = /iPhone|iPad|iPod/.test((await headers()).get("user-agent") ?? "");
  if (session.demo) return <DemoAccount error={errorMessage(param(search.error))} />;
  const [sessions, devices, assistants] = await Promise.all([
    listSessions(session.accountId, session.id),
    myDevices(session.id),
    listConnectedApps(session.accountId),
  ]);
  // Listed while OAuth is on, and afterwards for as long as any grant is left.
  const showAssistants = oauthConfig() !== null || assistants.length > 0;
  const error = errorMessage(param(search.error));
  const notice = noticeMessage(param(search.notice));

  return (
    <>
      <PageHeader eyebrow="Account" title="Account" subtitle={`Signed in as ${session.email}.`} />

      {error && (
        <div className="form-message error" role="alert" style={{ maxWidth: 560 }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="form-message notice" role="status" style={{ maxWidth: 560 }}>
          {notice}
        </div>
      )}

      <section className="rise" style={{ marginTop: 8 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Your iPhones</div>
        <ConnectIphone returnToApp={returnToApp} />
        {devices.length > 0 && (
          <div className="panel" style={{ maxWidth: 720, marginTop: 14 }}>
            {devices.map((d) => (
              <div key={d.id} className="session-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 550 }}>
                    {d.name || "iPhone"} <span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>{d.prefix}…</span>
                    {!d.active && <span className="chip" style={{ marginLeft: 8 }}>Disconnected</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                    Connected {formatFull(d.createdAt)}
                    {d.lastSeenAt ? ` · last upload ${formatFull(d.lastSeenAt)}` : " · no upload yet"}
                  </div>
                </div>
                {d.active && (
                  <form method="post" action="/api/auth/devices">
                    <input type="hidden" name="id" value={d.id} />
                    <button type="submit" className="btn">Disconnect</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {showAssistants && (
        <section className="rise" style={{ marginTop: 28 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>AI assistants</div>
          <div className="panel" style={{ maxWidth: 720 }}>
            {assistants.length === 0 && (
              <div className="session-row" style={{ fontSize: 13.5, color: "var(--muted)" }}>
                No assistant is connected. Add this viewer&apos;s MCP server as a connector in Claude to read your data
                there; you will be asked here first.
              </div>
            )}
            {assistants.map((a) => (
              <div key={a.id} className="session-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 550 }}>
                    {a.clientName || "An unnamed app"}{" "}
                    <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 400 }}>(self-reported name)</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                    Connected {formatFull(a.createdAt)} · last used {formatFull(a.lastUsedAt)} · reads all your data, read-only
                  </div>
                </div>
                <form method="post" action="/api/auth/assistants">
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="btn">Revoke</button>
                </form>
              </div>
            ))}
          </div>
          {assistants.length > 0 && (
            <p className="form-hint" style={{ margin: "10px 0 0", maxWidth: 720, lineHeight: 1.5 }}>
              Revoking stops an assistant at once from renewing its access; the access it already holds expires within
              30 minutes.
            </p>
          )}
        </section>
      )}

      <section className="rise" style={{ marginTop: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Password</div>
        <form method="post" action="/api/auth/password" className="panel" style={{ padding: "20px 20px 6px", maxWidth: 560 }}>
          <input type="text" name="username" value={session.email} autoComplete="username" readOnly hidden />
          <div className="form-field">
            <label htmlFor="current">Current password</label>
            <input id="current" name="current" type="password" autoComplete="current-password" required />
          </div>
          <div className="form-field">
            <label htmlFor="password">New password</label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
            <span className="form-hint">
              At least {PASSWORD_MIN_LENGTH} characters. Changing it signs out every other browser and disconnects every AI
              assistant.
            </span>
          </div>
          <div className="form-field">
            <label htmlFor="confirm">Repeat the new password</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
          </div>
          <div style={{ marginBottom: 14 }}>
            <button type="submit" className="btn btn-primary">Change password</button>
          </div>
        </form>
      </section>

      <section className="rise" style={{ marginTop: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Signed in</div>
        <div className="panel" style={{ maxWidth: 720 }}>
          {sessions.map((s) => (
            <div key={s.id} className="session-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 550 }}>
                  {describeAgent(s.userAgent)}
                  {s.current && <span className="chip" style={{ marginLeft: 8 }}>This browser</span>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                  Last active {formatFull(s.lastSeenAt)} · signed in {formatFull(s.createdAt)}
                  {s.ip ? ` · ${s.ip}` : ""}
                </div>
              </div>
              <form method="post" action="/api/auth/sessions">
                <input type="hidden" name="session" value={s.id} />
                <button type="submit" className="btn">{s.current ? "Sign out" : "Sign out this browser"}</button>
              </form>
            </div>
          ))}
        </div>
        {sessions.length > 1 && (
          <form method="post" action="/api/auth/sessions" style={{ marginTop: 14 }}>
            <input type="hidden" name="session" value="others" />
            <button type="submit" className="btn">Sign out everywhere else</button>
          </form>
        )}
      </section>

      {session.selfService && !session.isAdmin && (
        // The anchor is the app's Delete PulsHealth Account link
        // (PulsHealthDatabase.deleteAccountURL): App Review wants a link
        // straight to account deletion. Keep the id.
        <section id="delete-account" className="rise" style={{ marginTop: 28, scrollMarginTop: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Delete account</div>
          <form method="post" action="/api/auth/delete-account" className="panel" style={{ padding: 20, maxWidth: 560 }}>
            <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5 }}>
              Deleting your account signs you out everywhere and disconnects your iPhones at once, so nothing more is
              uploaded. The operator is told to delete everything stored for you. To keep your data, export it from the
              PulsHealth app first.
            </p>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 14 }}>
              <input type="checkbox" name="confirm" value="yes" required /> Delete my account and my data
            </label>
            <button type="submit" className="btn" style={{ color: "#ff7b72" }}>Delete my account</button>
          </form>
        </section>
      )}
    </>
  );
}

// The demo account's page: no email, browsers, devices, assistants, password
// or deletion — strangers share it, and none of those is theirs to see or
// change.
function DemoAccount({ error }: { error: string | null }) {
  return (
    <>
      <PageHeader eyebrow="Account" title="Demo account" subtitle="You are exploring PulsHealth with sample data." />
      {error && (
        <div className="form-message error" role="alert" style={{ maxWidth: 560 }}>
          {error}
        </div>
      )}
      <section className="rise" style={{ marginTop: 8 }}>
        <div className="panel" style={{ padding: 20, maxWidth: 560 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span className="dot" style={{ background: "#ff9f0a" }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Demo · sample data</span>
          </div>
          <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.55, color: "var(--fg-soft)" }}>
            This is a shared demo account. Its health records are de-identified sample data. Browse every page
            as you would your own; nothing here can be changed, and this visit ends after {DEMO_SESSION_HOURS} hours.
          </p>
          <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.55 }}>
            To connect your iPhone, sign in to your own account first.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href="/login?next=%2Fconnect%2Fiphone" className="btn btn-primary">Sign in to your account</a>
            {signupsOpen() && (
              <a href="/signup" className="btn btn-primary">
                Create your account
              </a>
            )}
            <form method="post" action="/api/auth/logout">
              <button type="submit" className="btn">Sign out</button>
            </form>
          </div>
        </div>
      </section>
    </>
  );
}

// "Safari on macOS", "Chrome on Android", … from a User-Agent; good enough to
// tell your own browsers apart, never used for anything else.
function describeAgent(agent: string | null): string {
  if (!agent) return "Unknown browser";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}
