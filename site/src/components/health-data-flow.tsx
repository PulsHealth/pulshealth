"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, Bot, Check, Database, FileSpreadsheet, Heart, LayoutDashboard, Moon, Pause, Play } from "lucide-react";
import styles from "./health-data-flow.module.css";

const routes = [
  "M 300 195 H 395 Q 425 195 425 225 H 520",
  "M 650 225 H 705 Q 735 225 735 135 H 810",
  "M 650 225 H 705 Q 735 225 735 300 H 810",
  "M 300 300 H 350 Q 375 300 375 385 H 510",
];

/** Illustrative data only. Database-backed tools and local exports use separate paths. */
export function HealthDataFlow() {
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <figure ref={ref} className={styles.figure} data-paused={paused || !visible} aria-label="PulsHealth sends Apple Health data to your database for dashboards and AI, or exports files directly to your device.">
      <div className={styles.stage}>
        <div className={styles.grid} aria-hidden />
        <svg className={styles.connections} viewBox="0 0 1100 460" fill="none" aria-hidden>
          {routes.map((d, i) => <g key={d} className={i === 3 ? styles.exportRoute : undefined}>
            <path d={d} className={styles.track} />
            <path d={d} pathLength="100" className={styles.packet} style={{ animationDelay: `${i * -1.4}s` }} />
          </g>)}
        </svg>

        <div className={styles.phone} aria-hidden>
          <div className={styles.phoneTop}><span>9:41</span><span className={styles.island} /><span>•••</span></div>
          <div className={styles.phoneHeading}><span className={styles.appIcon}><Activity size={21} /></span>PulsHealth</div>
          <div className={styles.phoneTitle}>Your health.</div>
          <p className={styles.phoneSubtitle}>Ready for what’s next.</p>
          <div className={styles.reading}><Heart size={17} /><span>Heart rate<small>Latest reading</small></span><strong>64<small>bpm</small></strong></div>
          <div className={styles.reading}><Activity size={17} /><span>Steps<small>Today</small></span><strong>8,432</strong></div>
          <div className={styles.reading}><Moon size={17} /><span>Sleep<small>Last night</small></span><strong>7h 42m</strong></div>
          <div className={styles.syncStatus}><span /> Connected to your database<Check size={13} /></div>
          <div className={styles.phoneBar} />
        </div>

        <span className={styles.syncLabel}>Background sync</span>
        <div className={styles.database}>
          <div className={styles.databaseIcon}><Database size={39} strokeWidth={1.3} /></div>
          <strong>Your database</strong><span>Owned by you</span>
          <div className={styles.databaseBars} aria-hidden><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
        </div>
        <a href="#web-app" className={`${styles.destination} ${styles.dashboard}`}><LayoutDashboard size={23} /><span><strong>Explore on the web</strong><small>Dashboard & API</small></span><ArrowUpRight size={16} /></a>
        <Link href="/docs/ai/" className={`${styles.destination} ${styles.ai}`}><Bot size={24} /><span><strong>Your AI tools</strong><small>Through your database</small></span><ArrowUpRight size={16} /></Link>
        <Link href="/features/#export" className={`${styles.destination} ${styles.files}`}><FileSpreadsheet size={25} /><span><strong>CSV & JSON</strong><small>For spreadsheets & projects</small></span><ArrowUpRight size={16} /></Link>
        <span className={styles.exportLabel}>Export directly</span>
      </div>
      <figcaption className={styles.caption}>
        <span>Your data, wherever you want to take it. <span className={styles.sampleLabel}>Illustrative data.</span></span>
        <button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused} aria-label={paused ? "Play data animation" : "Pause data animation"} className={styles.motionButton}>
          {paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}<span>{paused ? "Play" : "Pause"}</span>
        </button>
      </figcaption>
    </figure>
  );
}
