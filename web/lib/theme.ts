import type { ClientPref } from "./clientPref";

export type Theme = "dark" | "light";

export const THEME_KEY = "puls-theme";

// The inline bootstrap in app/layout.tsx stamps data-theme on <html> before the
// first paint, so the attribute — not localStorage — is the live value. Every
// theme change goes through it, which is why one MutationObserver is enough to
// keep both the toggle and the map in step.
export const themePref: ClientPref<Theme> = {
  read: () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
  subscribe: (onChange) => {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  },
  serverDefault: "dark",
};

export function writeTheme(next: Theme): void {
  // Setting the attribute is what notifies readers; the observer does the rest.
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
}
