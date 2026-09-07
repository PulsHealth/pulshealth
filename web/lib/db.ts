// Thin Postgres access. Server-only — never import from a client component.
import { Pool } from "pg";

let pool: Pool | null = null;
let initialized = false;

export function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!initialized) {
    initialized = true;
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 10_000,
      // Don't let a heavy ad-hoc query wedge a request.
      statement_timeout: 20_000,
      query_timeout: 22_000,
    });
    // Swallow background idle-client errors so they don't crash the process.
    pool.on("error", () => {});
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL not configured");
  const res = await p.query(text, params);
  return res.rows as T[];
}
