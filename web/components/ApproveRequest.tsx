"use client";

import { useActionState } from "react";

import { approveRequest, type ApproveState } from "@/app/admin/actions";

// The Approve and Decline buttons of one request on /admin, and what came of
// approving it (Decline is a plain form post to /api/admin).
export function ApproveRequest({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ApproveState, FormData>(approveRequest, null);
  if (state?.ok) {
    return (
      <div className="form-message notice" role="status" style={{ margin: 0 }}>
        Approved{state.emailed ? ` — an invite was emailed to ${state.email}.` : "."}
        {state.inviteUrl && (
          <>
            {" "}The email could not be sent; send {state.email} this link yourself (it works once, for 7 days):
            <code style={{ display: "block", marginTop: 6, wordBreak: "break-all", userSelect: "all" }}>{state.inviteUrl}</code>
          </>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Approving…" : "Approve"}
        </button>
      </form>
      <form method="post" action="/api/admin">
        <input type="hidden" name="action" value="deny" />
        <input type="hidden" name="id" value={id} />
        <button type="submit" className="btn" disabled={pending}>Decline</button>
      </form>
      {state && !state.ok && <span style={{ color: "#ff7b72", fontSize: 13 }}>{state.error}</span>}
    </div>
  );
}
