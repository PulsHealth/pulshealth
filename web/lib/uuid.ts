// The one UUID check in the viewer.
//
// The canonical 8-4-4-4-12 hex form, any version or variant, either case:
// exactly what ingest accepts for X-User-ID, batch ids and sample ids
// (`isUUID` in server/ingest/parse.go) and what Postgres's `uuid` type casts.
// Deliberately not a v1–v5 check: user ids come from phones and pairing
// codes the viewer did not mint, so a stricter test here would refuse a user
// ingest already stores (a v7 id, say), and a looser one would let a value
// reach a `::uuid` cast and fail it as a 500 instead of a 400 or not-found.

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a string in the canonical UUID form (see above). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
