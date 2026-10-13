"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

const views = [
  {
    label: "Today dashboard",
    src: "/screenshots/viewer-today.webp",
    alt: "PulsHealth web app: activity rings, daily health metrics, recent workouts, and health categories",
  },
  {
    label: "Workout history",
    src: "/screenshots/viewer-workouts.webp",
    alt: "PulsHealth web app: workout history with session totals, duration, energy, and distance",
  },
];

export function WebAppPreview() {
  const [selected, setSelected] = useState(0);
  const view = views[selected];

  return (
    <figure className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-black/25">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3 sm:px-5">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Web app preview">
          {views.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={selected === index}
              aria-controls="web-app-screenshot"
              onClick={() => setSelected(index)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === index ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <a href="https://app.pulshealth.com/demo" className="inline-flex items-center gap-2 px-2 py-2 text-sm font-medium text-brand hover:underline">
          Open live demo <ArrowUpRight className="h-4 w-4" aria-hidden />
        </a>
      </div>
      <div id="web-app-screenshot" aria-live="polite" aria-atomic="true">
        <Image src={view.src} alt={view.alt} width={1440} height={900} className="block w-full" />
      </div>
      <figcaption className="border-t px-5 py-3 text-sm text-muted-foreground">The PulsHealth web app, shown with demo data.</figcaption>
    </figure>
  );
}
