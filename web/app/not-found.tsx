import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", textAlign: "center" }}>
      <div>
        <div className="metric-num" style={{ fontSize: 72, fontWeight: 600, color: "var(--faint)" }}>404</div>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>That metric isn&apos;t in the catalog.</p>
        <Link href="/" className="chip" style={{ marginTop: 18, cursor: "pointer" }}>
          ← Back to Today
        </Link>
      </div>
    </div>
  );
}
