"use client";

// View-only unit preference (metric/imperial), persisted in localStorage. Stored
// data is always canonical/metric; this only affects display. Defaults to metric;
// reads the saved choice after mount (so SSR and first client render agree).

import { createContext, useContext, useEffect, useState } from "react";
import type { UnitSystem } from "@/lib/units";

const KEY = "puls-units";

interface UnitsCtx {
  system: UnitSystem;
  setSystem: (s: UnitSystem) => void;
}

const Ctx = createContext<UnitsCtx>({ system: "metric", setSystem: () => {} });

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const [system, setState] = useState<UnitSystem>("metric");

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "imperial" || v === "metric") setState(v);
    } catch {}
  }, []);

  function setSystem(s: UnitSystem) {
    setState(s);
    try {
      localStorage.setItem(KEY, s);
    } catch {}
  }

  return <Ctx.Provider value={{ system, setSystem }}>{children}</Ctx.Provider>;
}

export function useUnits(): UnitsCtx {
  return useContext(Ctx);
}
