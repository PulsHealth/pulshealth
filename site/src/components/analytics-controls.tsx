"use client";

import {useEffect, useState} from "react";
import {analyticsPreferenceEvent, setBrowserExcluded} from "@/lib/analytics-preferences";

export function AnalyticsControls() {
  const [excluded, setExcluded] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => { try { setExcluded(localStorage.getItem("umami.disabled") === "1"); } catch { setError("This browser does not allow the preference to be read."); } };
    update();
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  function toggle() {
    try {
      const next = !excluded;
      setBrowserExcluded(localStorage, next);
      setExcluded(next);setError("");
      window.dispatchEvent(new Event(analyticsPreferenceEvent));
    } catch { setError("Could not save this preference. Check this browser’s storage settings."); }
  }
  return <section aria-labelledby="analytics-controls-heading" className="mb-8 rounded-xl border p-6">
    <h2 id="analytics-controls-heading" className="text-xl font-semibold">Website analytics controls</h2>
    <p className="mt-2 text-sm text-muted-foreground">Exclude your own visits from PulsHealth website analytics in this browser. This saves only an on/off preference on this website. It does not change the iPhone app.</p>
    <p role="status" className="mt-3 text-sm">{excluded === null ? "Checking this browser…" : excluded ? "Your visits are excluded in this browser." : "Your visits are included when analytics is available. Do Not Track and Global Privacy Control still apply."}</p>
    <button type="button" disabled={excluded === null} onClick={toggle} className="mt-3 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50">{excluded ? "Include my visits" : "Exclude my visits"}</button>
    <p className="mt-3 text-xs text-muted-foreground">The choice applies to this website and browser profile until you change it or clear site data. Referral links can still count an anonymous redirect before the page opens; use the normal homepage bookmark for your own browsing.</p>
    {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
  </section>;
}
