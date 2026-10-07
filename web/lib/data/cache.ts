// A per-key memo for reads that are slow and whose answer drifts slowly: the
// per-user stats (a count over every sample) and which types have
// metric_daily rows. An entry is fresh for `freshMs`; after that the old
// value is still returned at once while one background load replaces it, so
// only the first read of a key — after a restart, or for someone new — waits
// on the database. Concurrent first reads share one load. A failed refresh
// keeps the old value (the read has logged its own failure); a failed first
// load rejects, as an uncached read would.
export function staleWhileRevalidate<V>(freshMs: number, load: (key: string) => Promise<V>): (key: string) => Promise<V> {
  const entries = new Map<string, { value: V; at: number }>();
  const inFlight = new Map<string, Promise<V>>();

  function refresh(key: string): Promise<V> {
    const running = inFlight.get(key);
    if (running) return running;
    const promise = load(key)
      .then((value) => {
        entries.set(key, { value, at: Date.now() });
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  return async (key) => {
    const entry = entries.get(key);
    if (!entry) return refresh(key);
    if (Date.now() - entry.at >= freshMs) refresh(key).catch(() => {});
    return entry.value;
  };
}
