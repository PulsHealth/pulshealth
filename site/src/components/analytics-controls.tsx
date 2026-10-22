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
    <h2 id="analytics-controls-heading" className="text-xl font-semibold">Website statistics</h2>
    <p className="mt-2 text-sm text-muted-foreground">Anonymous daily totals help improve this website. You can exclude this browser; the choice saves only an on/off preference.</p>
    <p role="status" className="mt-3 text-sm">{excluded === null ? "Checking this browser…" : excluded ? "Your visits are excluded in this browser." : "Your visits are included when analytics is available. Do Not Track and Global Privacy Control still apply."}</p>
    <button type="button" disabled={excluded === null} onClick={toggle} className="mt-3 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50">{excluded ? "Include my visits" : "Exclude my visits"}</button>
    <p className="mt-3 text-xs text-muted-foreground">Applies to this browser until changed or site data is cleared. Referral redirects can count before the page opens.</p>
    {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
  </section>;
}
