// What a page throws when it cannot read its data, and how the error
// boundary (app/error.tsx, a client component) recognises it. No server
// imports here, so the boundary can import it.
//
// Next.js strips a server error's message before it reaches the browser in
// production but keeps a `digest` the error already carries (it is how
// redirect() and notFound() travel), so the digest is the marker.

export const DATA_UNAVAILABLE_DIGEST = "PULS_DATA_UNAVAILABLE";

/**
 * The page's data could not be read: the "error" source (no database, an
 * unreachable one, accounts mode on the wrong role) or a read that failed.
 * The page shows "Database unavailable" instead of empty charts that would
 * read as "no data".
 */
export class DataUnavailableError extends Error {
  readonly digest = DATA_UNAVAILABLE_DIGEST;

  constructor(readonly detail: string) {
    super(`Database unavailable: ${detail}`);
    this.name = "DataUnavailableError";
  }
}

/** True for a DataUnavailableError, including the digest-only copy a browser receives. */
export function isDataUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { digest?: unknown }).digest === DATA_UNAVAILABLE_DIGEST
  );
}
