"use client";

// View-only unit preference (metric/imperial), persisted in localStorage. Stored
// data is always canonical/metric; this only affects display. Defaults to metric
// on the server and in the first client render, then shows the saved choice.

import { createContext, useContext } from "react";
import { useClientPref, type ClientPref } from "@/lib/clientPref";
import type { UnitSystem } from "@/lib/units";

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

interface UnitsCtx {
  system: UnitSystem;
  setSystem: (s: UnitSystem) => void;
}

const Ctx = createContext<UnitsCtx>({ system: "metric", setSystem: () => {} });

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const system = useClientPref(unitsPref);

  function setSystem(s: UnitSystem) {
    try {
      localStorage.setItem(KEY, s);
    } catch {}
    try {
      window.dispatchEvent(new Event(UNITS_EVENT));
    } catch {}
  }

  return <Ctx.Provider value={{ system, setSystem }}>{children}</Ctx.Provider>;
}

export function useUnits(): UnitsCtx {
  return useContext(Ctx);
}
