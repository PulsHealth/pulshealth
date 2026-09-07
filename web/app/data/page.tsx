import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ChevronRight, GroupIcon } from "@/components/Icons";
import { BROWSABLE_CATALOG, GROUPS, GROUP_LABELS, typeHref, typesInGroup } from "@/lib/catalog";
import { GROUP_COLOR } from "@/lib/colors";
import { getStats } from "@/lib/queries";
import { formatCompact, formatFull, relativeTime } from "@/lib/format";

// Always render live from the DB — no build-time demo snapshot, no stale cache.
export const dynamic = "force-dynamic";
export const metadata = { title: "All Data — PulsHealth" };

export default async function DataPage() {
  const stats = await getStats();
  const totalRows = BROWSABLE_CATALOG.reduce((s, t) => s + (stats.get(t.identifier)?.rows ?? 0), 0);
  const withData = BROWSABLE_CATALOG.filter((t) => (stats.get(t.identifier)?.rows ?? 0) > 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="All Data"
        subtitle="HealthKit quantity, category, and workout data with supported viewer pages, grouped the way Apple Health organizes it."
        right={
          <div className="chip">
            {formatCompact(totalRows)} samples · {withData}/{BROWSABLE_CATALOG.length} types
          </div>
        }
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        {GROUPS.map((g) => {
          const types = [...typesInGroup(g)].sort(
            (a, b) => (stats.get(b.identifier)?.rows ?? 0) - (stats.get(a.identifier)?.rows ?? 0),
          );
          const color = GROUP_COLOR[g];
          return (
            <section key={g} className="rise">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: `${color}1a`, color }}>
                  <GroupIcon group={g} size={15} />
                </span>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>{GROUP_LABELS[g]}</h2>
                <span className="mono" style={{ fontSize: 12, color: "var(--faint)" }}>{types.length}</span>
              </div>

              <div className="panel" style={{ overflow: "hidden" }}>
                {types.map((type, i) => {
                  const st = stats.get(type.identifier);
                  const rows = st?.rows ?? 0;
                  return (
                    <Link
                      key={type.identifier}
                      href={typeHref(type) ?? "/data"}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "13px 18px",
                        borderTop: i === 0 ? "none" : "1px solid var(--border)",
                        transition: "background 0.15s ease",
                      }}
                      className="data-row"
                    >
                      <span className="dot" style={{ background: rows > 0 ? color : "var(--faint)" }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, color: "var(--fg-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {type.name}
                          {type.unit && <span className="mono" style={{ color: "var(--faint)", fontSize: 11, marginLeft: 8 }}>{type.unit}</span>}
                        </div>
                      </div>
                      <div className="mono tabular" style={{ fontSize: 12.5, color: "var(--fg-soft)", minWidth: 86, textAlign: "right" }}>
                        {rows > 0 ? formatCompact(rows) : "—"}
                      </div>
                      <div className="mono" style={{ fontSize: 11.5, color: "var(--faint)", minWidth: 96, textAlign: "right" }} title={st?.latest ? formatFull(st.latest) : ""}>
                        {st?.latest ? relativeTime(st.latest) : "no data"}
                      </div>
                      <ChevronRight size={15} style={{ color: "var(--faint)" }} />
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
