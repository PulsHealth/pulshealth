"use client";

import { MoonIcon, SunIcon } from "./Icons";
import { useClientPref } from "@/lib/clientPref";
import { themePref, writeTheme } from "@/lib/theme";

export function ThemeToggle() {
  const theme = useClientPref(themePref);

  function toggle() {
    writeTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="nav-link"
      style={{ width: "100%", cursor: "pointer", background: "transparent" }}
      aria-label="Toggle color theme"
    >
      {theme === "dark" ? <SunIcon className="nav-icon" /> : <MoonIcon className="nav-icon" />}
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
