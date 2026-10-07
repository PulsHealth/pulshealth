"use client";

import { useActionState } from "react";

import { connectIphone, type ConnectState } from "@/app/account/actions";

// The account page's "Connect this iPhone". On the iPhone itself, the button
// that comes back opens PulsHealth with the pairing code (the app asks before
// it uses it); anywhere else, scan the code with the iPhone's camera.
export function ConnectIphone({ returnToApp = false }: { returnToApp?: boolean }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectIphone, null);
  if (state?.ok) {
    return (
      <div className="panel" style={{ padding: 20, maxWidth: 560 }}>
        <div style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 14 }}>
          <strong>On this iPhone?</strong> Tap Open in PulsHealth, confirm if asked, then tap Save &amp; Apply in the app.
          <strong> On a computer?</strong> Scan the code with your iPhone&apos;s camera, confirm in PulsHealth, then tap
          Save &amp; Apply. It is shown once; reload the page and it is gone.
        </div>
        <a href={state.link} className="btn btn-primary" style={{ marginBottom: 16 }}>
          Open in PulsHealth
        </a>
        <div
          style={{ width: 240, height: 240, borderRadius: 12, overflow: "hidden", background: "#fff" }}
          // Built on the server by lib/qr.ts from our own pairing link: a
          // single <svg> with a <rect> and a <path>, nothing executable.
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
        <p className="form-hint" style={{ margin: "12px 0 0", lineHeight: 1.5 }}>
          Don&apos;t have the app? Install PulsHealth from the App Store first. This code lets an iPhone upload to your records,
          so don&apos;t share it; if it leaks, disconnect it below.
        </p>
      </div>
    );
  }
  return (
    <form action={returnToApp ? "/api/auth/connect-iphone" : action} method={returnToApp ? "post" : undefined} className="panel" style={{ padding: "20px 20px 18px", maxWidth: 560 }}>
      <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.55 }}>
        {returnToApp
          ? "Connect this iPhone to return to PulsHealth, then tap Save & Apply in the app."
          : "Connect an iPhone to get its pairing link and QR code. In the app, tap Save & Apply to start syncing."}
      </p>
      <div className="form-field">
        <label htmlFor="device-name">Name this iPhone</label>
        <input id="device-name" name="name" type="text" maxLength={100} placeholder="My iPhone" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Connecting…" : "Connect this iPhone"}
      </button>
      {state && !state.ok && (
        <div className="form-message error" role="alert" style={{ margin: "14px 0 0" }}>
          {state.error}
        </div>
      )}
    </form>
  );
}
