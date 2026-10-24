"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight, Activity, Code2, Database, Footprints, Globe2, Heart, LayoutDashboard, LockKeyhole, Moon, Smartphone } from "lucide-react";
import styles from "./web-app-preview.module.css";

const metrics = [
  { label: "Steps", icon: Footprints, value: "8,246", unit: "steps", title: "Your week in steps", color: "#8bc9ff", values: [5230, 7100, 6420, 9100, 7840, 10600, 8246], format: (value: number) => value.toLocaleString("en-US") },
  { label: "Sleep", icon: Moon, value: "7h 42m", unit: "hours", title: "Your week in sleep", color: "#bbaaf0", values: [7.2, 6.8, 7.5, 8.1, 7.1, 8.4, 7.7], format: (value: number) => `${Math.floor(value)}h ${Math.round((value % 1) * 60)}m` },
  { label: "Heart rate", icon: Heart, value: "54", unit: "bpm", title: "Your resting heart rate", color: "#e5a1ad", values: [59, 56, 58, 55, 57, 53, 54], format: (value: number) => `${value} bpm` },
];
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const samples = [
  { label: "Resting heart rate", identifier: "HKQuantityTypeIdentifierRestingHeartRate", unit: "count/min", value: 54 },
  { label: "Heart rate variability", identifier: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", unit: "ms", value: 48 },
];

export function WebAppPreview() {
  const [view, setView] = useState("dashboard");
  const [metric, setMetric] = useState(0);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [arrived, setArrived] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setArrived(true); observer.disconnect(); }
    }, { threshold: 0.15 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const selected = metrics[metric];
  const sample = samples[sampleIndex];
  const response = JSON.stringify({ metrics: [{ identifier: sample.identifier, unit: sample.unit, value: sample.value, timestamp: 1792713600000 }] }, null, 2);

  return <figure ref={ref} className={styles.scene} data-arrived={arrived}>
    <div className={styles.connection} aria-label="From your iPhone, through your database, to the web">
      <span><Smartphone aria-hidden />Your iPhone</span>
      <i className={styles.connectionLine} aria-hidden />
      <span><Database aria-hidden />Your database</span>
      <i className={styles.connectionLine} aria-hidden />
      <span><Globe2 aria-hidden />On the web</span>
    </div>
    <div className={styles.preview}>
      <div className={styles.browserBar}>
        <div className={styles.windowDots} aria-hidden><i /><i /><i /></div>
        <span className={styles.address}><LockKeyhole size={12} aria-hidden />app.pulshealth.com</span>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.controls} role="group" aria-label="Web app preview">
          <button type="button" aria-pressed={view === "dashboard"} aria-controls="web-app-preview-content" onClick={() => setView("dashboard")}><LayoutDashboard size={16} aria-hidden />Dashboard</button>
          <button type="button" aria-pressed={view === "api"} aria-controls="web-app-preview-content" onClick={() => setView("api")}><Code2 size={16} aria-hidden />API</button>
        </div>
        <Link className={styles.openLink} href={view === "dashboard" ? "https://app.pulshealth.com/demo" : "/docs/api-reference/"}>{view === "dashboard" ? "Open dashboard" : "API reference"}<ArrowUpRight size={15} aria-hidden /></Link>
      </div>
      <div id="web-app-preview-content">
        {view === "dashboard" ? <div className={styles.dashboard}>
          <div className={styles.dashboardHeading}><div><h3>Your health, at a glance.</h3><p>A little more room to see the whole picture.</p></div><span className={styles.syncStatus}><i aria-hidden />Synced from iPhone</span></div>
          <div className={styles.metrics} role="group" aria-label="Explore a health metric">
            {metrics.map((item, index) => <button type="button" key={item.label} aria-pressed={metric === index} aria-controls="health-week-chart" onClick={() => setMetric(index)} style={{ "--metric-color": item.color } as CSSProperties}>
              <span className={styles.metricLabel}><item.icon size={15} aria-hidden />{item.label}</span>
              <strong>{item.value}{index !== 1 && <small>{item.unit}</small>}</strong>
              <span className={styles.metricUnderline} aria-hidden />
            </button>)}
          </div>
          <div id="health-week-chart" className={styles.chart} style={{ "--metric-color": selected.color } as CSSProperties}>
            <div className={styles.chartHeading}><h4>{selected.title}</h4><span>Last 7 days</span></div>
            <div key={metric} className={styles.bars} role="img" aria-label={`${selected.title}. ${days.map((day, index) => `${day}: ${selected.format(selected.values[index])}`).join(", ")}`}>
              {selected.values.map((value, index) => <div className={styles.barColumn} key={days[index]}>
                <span className={styles.barValue}>{selected.format(value)}</span>
                <div className={styles.barTrack}><i style={{ height: `${value / Math.max(...selected.values) * 90}%`, animationDelay: `${index * 65}ms` }} /></div>
                <span className={styles.day}>{days[index]}</span>
              </div>)}
            </div>
          </div>
          <div className={styles.workout}><span className={styles.workoutIcon}><Activity size={20} aria-hidden /></span><div><strong>Morning run</strong><span>Latest workout</span></div><p>5.2 <small>km</small></p><p>31 <small>min</small></p></div>
        </div> : <div className={styles.apiPanel}>
          <div className={styles.apiIntro}><Code2 size={28} strokeWidth={1.3} aria-hidden /><h3>Your data.<br /> In your own tools.</h3><p>Use the same health data in your scripts, dashboards, and next idea.</p><Link href="/docs/api/">Explore the API <ArrowUpRight size={15} aria-hidden /></Link></div>
          <div className={styles.codePanel}>
            <div className={styles.sampleControls}><label htmlFor="sample-metric">Example request</label><select id="sample-metric" value={sampleIndex} onChange={e => setSampleIndex(Number(e.target.value))}>{samples.map((s, i) => <option key={s.identifier} value={i}>{s.label}</option>)}</select></div>
            <div className={styles.request}><span>GET</span><code>/v1/metrics/latest?types={sample.identifier}</code></div>
            <div className={styles.responseLabel}><span>200 OK</span>Example response</div>
            <pre key={sample.identifier} tabIndex={0} aria-label={`Example API response for ${sample.label}`}><code>{response}</code></pre>
          </div>
        </div>}
      </div>
    </div>
    {view === "api" && <figcaption className={styles.caption}>Example data. Connect to your server to make API requests.</figcaption>}
  </figure>;
}
