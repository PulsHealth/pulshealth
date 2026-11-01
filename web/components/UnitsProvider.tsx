"use client";

// View-only unit preference (metric/imperial), persisted in localStorage. Stored
// data is always canonical/metric; this only affects display. Defaults to metric
// on the server and in the first client render, then shows the saved choice.

import { createContext, useContext, useMemo } from "react";
import { useClientPref, type ClientPref } from "@/lib/clientPref";
import { parseUnitOverrides, type UnitSystem, type UnitOverrides, type UnitPreferences } from "@/lib/units";

const KEY = "puls-units";
// Same-tab change notification (storage events only fire cross-tab).
const UNITS_EVENT = "puls-unitschange";

const unitsPref: ClientPref<UnitSystem> = {
  read: () => {
    try {
      const v = localStorage.getItem(KEY);
      return v === "imperial" || v === "metric" ? v : "metric";
    } catch {
      return "metric";
    }
  },
  subscribe: (onChange) => {
    window.addEventListener(UNITS_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(UNITS_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  },
  serverDefault: "metric",
};

const OVERRIDES_KEY = "puls-unit-overrides";
const overridesPref: ClientPref<string> = {
  ...unitsPref,
  read: () => { try { return localStorage.getItem(OVERRIDES_KEY) ?? "{}"; } catch { return "{}"; } },
  serverDefault: "{}",
};

interface UnitsCtx {
  preferences: UnitPreferences;
  setOverrides: (overrides: UnitOverrides) => void;
  system: UnitSystem;
  setSystem: (s: UnitSystem) => void;
}

const Ctx = createContext<UnitsCtx>({ system: "metric", preferences: { system: "metric" }, setSystem: () => {}, setOverrides: () => {} });

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const system = useClientPref(unitsPref);
  const rawOverrides = useClientPref(overridesPref);
  const preferences = useMemo(() => ({ system, ...parseUnitOverrides(rawOverrides) }), [system, rawOverrides]);
  function setOverrides(next: UnitOverrides) {
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next)); } catch {}
    window.dispatchEvent(new Event(UNITS_EVENT));
  }

  function setSystem(s: UnitSystem) {
    try {
      localStorage.setItem(KEY, s);
      localStorage.removeItem(OVERRIDES_KEY);
    } catch {}
    try {
      window.dispatchEvent(new Event(UNITS_EVENT));
    } catch {}
  }

  return <Ctx.Provider value={{ system, setSystem, preferences, setOverrides }}>{children}</Ctx.Provider>;
}

export function useUnits(): UnitsCtx {
  return useContext(Ctx);
}
