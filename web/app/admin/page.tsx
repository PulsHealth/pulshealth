import { reportingTimeZone } from "@/lib/reportingTimeZone";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApproveRequest } from "@/components/ApproveRequest";
import { PageHeader } from "@/components/PageHeader";
import { currentAdmin } from "@/lib/accounts/admin";
import { errorMessage, noticeMessage, param } from "@/lib/accounts/messages";
import {
  listAccounts,
  listSignupRequests,
  listUnusedApprovals,
  pendingSignupCount,
  SIGNUP_DAILY_CAP,
  SIGNUP_PENDING_CAP,
  signupsToday,
} from "@/lib/accounts/signups";
import { mailConfig } from "@/lib/email";
import { formatFull } from "@/lib/format";
import { signupsOpen } from "@/lib/mode";

// The operator's page (accounts mode, administrators only; anyone else gets
// a 404): the sign-up waitlist to approve or decline, and the accounts, which
// can be disabled — that also disconnects their iPhones — and, once
// disabled, have their data purged.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin — PulsHealth" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminPage({ searchParams }: { searchParams: Search }) {
  const admin = await currentAdmin();
  if (!admin) notFound();
  const timeZone = await reportingTimeZone(admin.userId);
  const search = await searchParams;
  const [requests, accounts, unused, waiting, today] = await Promise.all([
    listSignupRequests(),
    listAccounts(),
    listUnusedApprovals(),
    pendingSignupCount(),
    signupsToday(),
  ]);
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  const error = errorMessage(param(search.error));
  const notice = noticeMessage(param(search.notice));
  const mail = mailConfig();

  return (
    <>
      <PageHeader
        title="Admin"
        subtitle={
          signupsOpen()
            ? "People sign up at /signup and join the waitlist. Nothing exists for them until you approve."
            : "Sign-up requests are off (WEB_SIGNUPS). Invite people with make web-invite."
        }
      />
      {error && <div className="form-message error" role="alert" style={{ maxWidth: 720 }}>{error}</div>}
      {notice && <div className="form-message notice" role="status" style={{ maxWidth: 720 }}>{notice}</div>}
      {!mail?.admin && (
        <div className="form-message" style={{ maxWidth: 720 }}>
          Email is not set up ({mail ? "WEB_ADMIN_EMAIL" : "WEB_SES_* and WEB_MAIL_FROM"} in server/.env), so new sign-ups only show
          up here{mail ? "" : ", and approved people get no email: you will be shown their invite link to send yourself"}.
        </div>
      )}

      <section className="rise" style={{ marginTop: 8 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Waitlist · {waiting}
          {waiting > pending.length ? ` (the oldest ${pending.length} shown)` : ""}
        </div>
        {(waiting >= SIGNUP_PENDING_CAP || today >= SIGNUP_DAILY_CAP) && (
          <div className="form-message" role="status" style={{ maxWidth: 720 }}>
            {waiting >= SIGNUP_PENDING_CAP
              ? `${SIGNUP_PENDING_CAP} people are on the waitlist, so new sign-ups are dropped until you decide some`
              : `${SIGNUP_DAILY_CAP} people joined the waitlist in the last 24 hours, so new sign-ups are dropped until that eases`}{" "}
            (the form still tells people they are on the waitlist).
          </div>
        )}
        <div className="panel" style={{ maxWidth: 820 }}>
          {pending.length === 0 && <div className="session-row" style={{ color: "var(--muted)", fontSize: 14 }}>No one on the waitlist.</div>}
          {pending.map((r) => (
            <div key={r.id} className="session-row" style={{ alignItems: "flex-start" }}>
              {/* Ticks belong to the Decline selected form below (form attribute: no nested forms). */}
              <input
                type="checkbox"
                name="ids"
                value={r.id}
                form="decline-selected"
                aria-label={`Select ${r.email}`}
                style={{ marginTop: 4 }}
              />
              <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{r.name || r.email}</div>
                <div style={{ fontSize: 13.5, color: "var(--fg-soft)", marginTop: 2 }}>{r.email}</div>
                {r.note && <div style={{ fontSize: 13.5, marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{r.note}</div>}
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
                  Joined {formatFull(r.createdAt, timeZone)}
                  {r.ip ? ` · ${r.ip}` : ""}
                  {r.userAgent ? ` · ${r.userAgent.slice(0, 80)}` : ""}
                </div>
              </div>
              <ApproveRequest id={r.id} />
            </div>
          ))}
        </div>
        {pending.length > 1 && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 12, maxWidth: 820 }}>
            <form id="decline-selected" method="post" action="/api/admin">
              <input type="hidden" name="action" value="deny_many" />
              <input type="hidden" name="scope" value="selected" />
              <button type="submit" className="btn">Decline selected</button>
            </form>
            <form method="post" action="/api/admin" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <input type="hidden" name="action" value="deny_many" />
              <input type="hidden" name="scope" value="shown" />
              {pending.map((r) => (
                <input key={r.id} type="hidden" name="shown" value={r.id} />
              ))}
              <label style={{ fontSize: 12.5, color: "var(--muted)", display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" name="confirm" value="yes" required /> all {pending.length} shown
              </label>
              <button type="submit" className="btn">Decline all shown</button>
            </form>
          </div>
        )}
        <p className="form-hint" style={{ maxWidth: 720, lineHeight: 1.5 }}>
          Oldest first. Approving emails the person an invite; declining removes them from the waitlist and emails no one.
          People stay on the waitlist until you decide.
        </p>
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
                  {!a.selfService && !a.isAdmin && <span className="chip" style={{ marginLeft: 8 }}>Household</span>}
                  {a.deletionRequestedAt && <span className="chip" style={{ marginLeft: 8, color: "#ff7b72" }}>Asked to be deleted</span>}
                  {a.disabledAt && !a.deletionRequestedAt && <span className="chip" style={{ marginLeft: 8 }}>Disabled</span>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                  User {a.userId} · since {formatFull(a.createdAt, timeZone)}
                  {a.lastSeenAt ? ` · last active ${formatFull(a.lastSeenAt, timeZone)}` : ""}
                </div>
              </div>
              {a.selfService && !a.isAdmin && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {!a.deletionRequestedAt && (
                    <form method="post" action="/api/admin">
                      <input type="hidden" name="action" value={a.disabledAt ? "enable" : "disable"} />
                      <input type="hidden" name="id" value={a.id} />
                      <button type="submit" className="btn">{a.disabledAt ? "Enable" : "Disable"}</button>
                    </form>
                  )}
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
          for that user. It unpacks the compressed history it shares with others as it goes, so on a long history it can
          take several minutes; if the page times out first, the purge carries on and the account disappears from this
          list when it is done. Only accounts that came from an approved request can be changed here. Household accounts
          (invited with make web-invite) are managed from the server, and the viewer can never give them a sync token or
          delete their data.
        </p>
      </section>

      {unused.length > 0 && (
        <section className="rise" style={{ marginTop: 28 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Approved, invite not used yet · {unused.length}</div>
          <div className="panel" style={{ maxWidth: 820 }}>
            {unused.map((u) => (
              <div key={u.userId} className="session-row" style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                  <div style={{ fontSize: 14.5, fontWeight: 550 }}>{u.name || u.email}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                    {u.email} · last invited {formatFull(u.invitedAt, timeZone)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <ApproveRequest id={u.userId} mode="reinvite" />
                  <form method="post" action="/api/admin" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <input type="hidden" name="action" value="purge" />
                    <input type="hidden" name="id" value={u.userId} />
                    <label style={{ fontSize: 12.5, color: "var(--muted)", display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" name="confirm" value="yes" required /> remove them
                    </label>
                    <button type="submit" className="btn" style={{ color: "#ff7b72" }}>Remove</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section className="rise" style={{ marginTop: 28 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Approved in the last 30 days</div>
          <div className="panel" style={{ maxWidth: 820 }}>
            {decided.map((r) => (
              <div key={r.id} className="session-row">
                <div style={{ fontSize: 13.5 }}>
                  {r.name ? `${r.name} · ` : ""}{r.email}
                </div>
                <span className="chip">Approved{r.decidedAt ? ` ${formatFull(r.decidedAt, timeZone)}` : ""}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
