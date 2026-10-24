export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header
      className="rise"
      style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 28 }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: "clamp(32px, 4vw, 44px)", fontWeight: 550, letterSpacing: "-0.045em", lineHeight: 1.1 }}>
          {title}
        </h1>
        {subtitle && <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 16, maxWidth: 620, lineHeight: 1.6 }}>{subtitle}</p>}
      </div>
      {right && <div>{right}</div>}
    </header>
  );
}
