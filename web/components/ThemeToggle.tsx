"use client";

import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "./Icons";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const t = (document.documentElement.dataset.theme as "dark" | "light") || "dark";
    setTheme(t);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("puls-theme", next);
    } catch {}
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
