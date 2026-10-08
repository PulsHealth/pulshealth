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
        <h1 style={{ margin: 0, fontSize: "clamp(26px, 4vw, 38px)", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
          {title}
        </h1>
        {subtitle && <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 15, maxWidth: 560 }}>{subtitle}</p>}
      </div>
      {right && <div>{right}</div>}
    </header>
  );
}
