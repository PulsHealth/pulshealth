"use client";

// The error boundary for every page (the root layout, with the sidebar, stays
// up around it). A page whose data cannot be read — the database's "error"
// source, or a read that failed (lib/data/source.ts) — throws
// DataUnavailableError and lands here as "Database unavailable", rather than
// rendering empty charts that would read as "no data". Anything else is a
// plain "Something went wrong". In production the browser gets only the
// error's digest, never its message, which is why the digest is the marker.

import { isDataUnavailable } from "@/lib/data/unavailable";

export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const unavailable = isDataUnavailable(error);
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", textAlign: "center" }}>
      <div role="alert" style={{ maxWidth: 440 }}>
        <span className="chip" style={{ justifyContent: "center" }}>
          <span className="dot" style={{ background: "#ff453a" }} />
          {unavailable ? "Database unavailable" : "Something went wrong"}
        </span>
        <p style={{ color: "var(--muted)", marginTop: 14 }}>
          {unavailable
            ? "This page could not read its data: the database is unreachable, busy, or a read timed out. Nothing on the server has changed."
            : "This page failed to render."}
        </p>
        {error.digest && !unavailable && (
          <p className="mono" style={{ color: "var(--faint)", fontSize: 12, marginTop: 6 }}>
            {error.digest}
          </p>
        )}
        <button type="button" className="chip" style={{ marginTop: 18, cursor: "pointer" }} onClick={() => retry()}>
          Try again
        </button>
      </div>
    </div>
  );
}
