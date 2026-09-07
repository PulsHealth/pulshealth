import { NextResponse } from "next/server";
import { getDataSource } from "@/lib/queries";

// Deploy/health probes hit this instead of "/": the page renders 200 with a
// "Database unavailable" chip when Postgres is unreachable, which let a bad
// GRAFANA_DB_PASSWORD or missing grant ship as a verified deploy.
export const dynamic = "force-dynamic";

export async function GET() {
  const info = await getDataSource();
  const ok = info.source === "live";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", source: info.source, detail: info.detail ?? null },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
