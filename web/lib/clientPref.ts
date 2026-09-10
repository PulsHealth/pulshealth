import { useSyncExternalStore } from "react";

// A preference that exists only in the browser — a localStorage key, or an
// attribute the pre-hydration bootstrap stamped on <html>.
//
// The server cannot see any of them, so each one has to render a fixed default
// on the server and in the first client render, then show the real value. Doing
// that with useState plus a mount effect is what `react-hooks/set-state-in-effect`
// objects to, and it costs a second render of the whole subtree.
// useSyncExternalStore says the same thing directly: `serverDefault` is what SSR
// and hydration agree on, `read` is the live value, and `subscribe` keeps it
// current — including changes made in another tab.
export interface ClientPref<T> {
  // Must be callable only in the browser; React never calls it during SSR.
  read: () => T;
  subscribe: (onChange: () => void) => () => void;
  serverDefault: T;
}

// `read` must return a primitive (or a cached reference): useSyncExternalStore
// re-renders whenever the snapshot is not Object.is-equal to the previous one,
// so a fresh object every call would loop.
export function useClientPref<T>(pref: ClientPref<T>): T {
  return useSyncExternalStore(pref.subscribe, pref.read, () => pref.serverDefault);
}
