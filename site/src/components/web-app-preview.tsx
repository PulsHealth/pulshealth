"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Code2, LayoutDashboard, Activity, LockKeyhole } from "lucide-react";
import styles from "./web-app-preview.module.css";
const views = [
  { label: "Dashboard", icon: LayoutDashboard, title: "A clearer view of your day.", description: "Activity, sleep, heart rate, and your latest readings, together.", src: "/screenshots/viewer-today.webp", alt: "PulsHealth web app: activity rings, daily health metrics, recent workouts, and health categories" },
  { label: "Workouts", icon: Activity, title: "Every session. All the details.", description: "Explore your workout history, then open a session to go deeper.", src: "/screenshots/viewer-workouts.webp", alt: "PulsHealth web app: workout history with session totals, duration, energy, and distance" },
  { label: "API", icon: Code2, title: "Build with your own health data.", description: "A documented, read-only API for your scripts, dashboards, and next idea." },
];
const samples = [
  { label: "Resting heart rate", identifier: "HKQuantityTypeIdentifierRestingHeartRate", unit: "count/min", value: 54 },
  { label: "Heart rate variability", identifier: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", unit: "ms", value: 48 },
];
export function WebAppPreview() {
  const [selected, setSelected] = useState(0);
  const [metric, setMetric] = useState(0);
  const view = views[selected]; const sample = samples[metric];
  const response = JSON.stringify({ metrics: [{ identifier: sample.identifier, unit: sample.unit, value: sample.value, timestamp: 1792713600000 }] }, null, 2);
  return <figure className={styles.preview}>
    <div className={styles.toolbar}>
      <div className={styles.controls} role="group" aria-label="Web app preview">{views.map((item, index) => <button key={item.label} type="button" aria-pressed={selected === index} aria-controls="web-app-preview-content" onClick={() => setSelected(index)}><item.icon size={16} aria-hidden />{item.label}</button>)}</div>
      <span className={styles.serverLabel}><LockKeyhole size={12} aria-hidden />Connected to your database</span>
    </div>
    <div id="web-app-preview-content">
      <div className={styles.description} aria-live="polite"><div><h3>{view.title}</h3><p>{view.description}</p></div><Link href={selected === 2 ? "/docs/api-reference/" : "https://app.pulshealth.com/demo"}>{selected === 2 ? "API reference" : "Open live demo"}<ArrowUpRight size={16} aria-hidden /></Link></div>
      {selected < 2 ? <div className={styles.imageViewport} key={view.label}><Image src={view.src!} alt={view.alt!} width={1440} height={900} sizes="(max-width: 767px) 920px, (max-width: 1224px) 95vw, 1160px" className={styles.screenshot} /></div> : <div className={styles.apiPanel}>
        <div className={styles.apiIntro}><Code2 size={32} strokeWidth={1.3} aria-hidden /><h4>Your next idea<br />starts here.</h4><p>Read your latest measurements, explore daily trends, or export records. The same database, on your terms.</p><Link href="/docs/api/">Read the API guide <ArrowUpRight size={15} aria-hidden /></Link></div>
        <div className={styles.codePanel}>
          <div className={styles.sampleControls}><label htmlFor="sample-metric">Example request</label><select id="sample-metric" value={metric} onChange={e => setMetric(Number(e.target.value))}>{samples.map((s, i) => <option key={s.identifier} value={i}>{s.label}</option>)}</select></div>
          <div className={styles.request}><span>GET</span><code>/v1/metrics/latest?types={sample.identifier}</code></div>
          <div className={styles.responseLabel}><span>200 OK</span>Illustrative response</div>
          <pre key={sample.identifier} tabIndex={0} aria-label={`Example API response for ${sample.label}`}><code>{response}</code></pre>
        </div>
      </div>}
    </div>
    <figcaption className={styles.caption}>{selected === 2 ? "Example data. Connect to your own server to make authenticated API requests." : "The PulsHealth web app, shown with demo data."}<span className={styles.scrollHint}>{selected < 2 ? "Swipe to explore the preview." : ""}</span></figcaption>
  </figure>;
}
