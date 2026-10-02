import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApproveRequest } from "@/components/ApproveRequest";
import { PageHeader } from "@/components/PageHeader";
import { currentAdmin } from "@/lib/accounts/admin";
import { errorMessage, noticeMessage, param } from "@/lib/accounts/messages";
import { listAccounts, listSignupRequests } from "@/lib/accounts/signups";
import { mailConfig } from "@/lib/email";
import { formatFull } from "@/lib/format";
import { signupsOpen } from "@/lib/mode";

// The operator's page (accounts mode, administrators only; anyone else gets
// a 404): access requests to approve or decline, and the accounts, which
// can be disabled — that also disconnects their iPhones — and, once
// disabled, have their data purged.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin — PulsHealth" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminPage({ searchParams }: { searchParams: Search }) {
  const admin = await currentAdmin();
  if (!admin) notFound();
  const search = await searchParams;
  const [requests, accounts] = await Promise.all([listSignupRequests(), listAccounts()]);
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  const error = errorMessage(param(search.error));
  const notice = noticeMessage(param(search.notice));
  const mail = mailConfig();

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Admin"
        subtitle={
          signupsOpen()
            ? "People ask for access at /signup. Nothing exists for them until you approve."
            : "Sign-up requests are off (WEB_SIGNUPS). Invite people with make web-invite."
        }
      />
      {error && <div className="form-message error" role="alert" style={{ maxWidth: 720 }}>{error}</div>}
      {notice && <div className="form-message notice" role="status" style={{ maxWidth: 720 }}>{notice}</div>}
      {!mail?.admin && (
        <div className="form-message" style={{ maxWidth: 720 }}>
          Email is not set up ({mail ? "WEB_ADMIN_EMAIL" : "WEB_SES_* and WEB_MAIL_FROM"} in server/.env), so new requests only show
          up here{mail ? "" : ", and approved people get no email: you will be shown their invite link to send yourself"}.
        </div>
      )}

      <section className="rise" style={{ marginTop: 8 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Waiting for you · {pending.length}</div>
        <div className="panel" style={{ maxWidth: 820 }}>
          {pending.length === 0 && <div className="session-row" style={{ color: "var(--muted)", fontSize: 14 }}>No requests waiting.</div>}
          {pending.map((r) => (
            <div key={r.id} className="session-row" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{r.name || r.email}</div>
                <div style={{ fontSize: 13.5, color: "var(--fg-soft)", marginTop: 2 }}>{r.email}</div>
                {r.note && <div style={{ fontSize: 13.5, marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{r.note}</div>}
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
                  Asked {formatFull(r.createdAt)}
                  {r.ip ? ` · ${r.ip}` : ""}
                  {r.userAgent ? ` · ${r.userAgent.slice(0, 80)}` : ""}
                </div>
              </div>
              <ApproveRequest id={r.id} />
            </div>
          ))}
        </div>
      </section>

      <section className="rise" style={{ marginTop: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Accounts · {accounts.length}</div>
        <div className="panel" style={{ maxWidth: 820 }}>
          {accounts.map((a) => (
            <div key={a.id} className="session-row" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                <div style={{ fontSize: 14.5, fontWeight: 550 }}>
                  {a.email}
                  {a.isAdmin && <span className="chip" style={{ marginLeft: 8 }}>Admin</span>}
                  {a.deletionRequestedAt && <span className="chip" style={{ marginLeft: 8, color: "#ff7b72" }}>Asked to be deleted</span>}
                  {a.disabledAt && !a.deletionRequestedAt && <span className="chip" style={{ marginLeft: 8 }}>Disabled</span>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                  User {a.userId} · since {formatFull(a.createdAt)}
                  {a.lastSeenAt ? ` · last active ${formatFull(a.lastSeenAt)}` : ""}
                </div>
              </div>
              {!a.isAdmin && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <form method="post" action="/api/admin">
                    <input type="hidden" name="action" value={a.disabledAt ? "enable" : "disable"} />
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" className="btn">{a.disabledAt ? "Enable" : "Disable"}</button>
                  </form>
                  {a.disabledAt && (
                    <form method="post" action="/api/admin" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      <input type="hidden" name="action" value="purge" />
                      <input type="hidden" name="id" value={a.userId} />
                      <label style={{ fontSize: 12.5, color: "var(--muted)", display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" name="confirm" value="yes" required /> delete all their data
                      </label>
                      <button type="submit" className="btn" style={{ color: "#ff7b72" }}>Purge</button>
                    </form>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="form-hint" style={{ maxWidth: 720, lineHeight: 1.5 }}>
          Disabling ends an account&apos;s sessions and disconnects its iPhones at once. Purging deletes every record stored
          for that user, which decompresses old data as it goes and can take a minute on a long history.
        </p>
      </section>

      {decided.length > 0 && (
        <section className="rise" style={{ marginTop: 28 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Approved in the last 30 days</div>
          <div className="panel" style={{ maxWidth: 820 }}>
            {decided.map((r) => (
              <div key={r.id} className="session-row">
                <div style={{ fontSize: 13.5 }}>
                  {r.name ? `${r.name} · ` : ""}{r.email}
                </div>
                <span className="chip">Approved{r.decidedAt ? ` ${formatFull(r.decidedAt)}` : ""}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
