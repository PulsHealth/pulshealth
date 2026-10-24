"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FileJson, FileSpreadsheet, Sparkles } from "lucide-react";
import styles from "./health-data-flow.module.css";

export function HealthDataFlow() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return <figure ref={ref} className={styles.figure} data-paused={!visible}>
    <div className={styles.stage}>
      <div className={styles.halo} aria-hidden />
      <svg className={`${styles.streams} ${styles.desktopStreams}`} viewBox="0 0 1100 560" fill="none" preserveAspectRatio="none" aria-hidden>
        {Array.from({ length: 7 }, (_, i) => {
          const y = 190 + i * 18;
          return <g key={i}>
            <path d={`M 630 ${y} C 720 ${y}, 720 ${265 + i * 7}, 840 ${265 + i * 7}`} className={styles.thread} />
            <path d={`M 630 ${y} C 720 ${y}, 720 ${265 + i * 7}, 840 ${265 + i * 7}`} pathLength="100" className={styles.packet} style={{ animationDelay: `${i * -.45}s` }} />
          </g>;
        })}
        {Array.from({ length: 4 }, (_, i) => <g key={i} className={styles.fileStream}>
          <path d={`M 450 ${305 + i * 15} C 340 ${305 + i * 15}, 355 ${255 + i * 10}, 265 ${255 + i * 10}`} className={styles.thread} />
          <path d={`M 450 ${305 + i * 15} C 340 ${305 + i * 15}, 355 ${255 + i * 10}, 265 ${255 + i * 10}`} pathLength="100" className={styles.packet} style={{ animationDelay: `${i * -.8}s` }} />
        </g>)}
      </svg>
      <svg className={`${styles.streams} ${styles.mobileStreams}`} viewBox="0 0 350 510" fill="none" preserveAspectRatio="none" aria-hidden>
        {["files", "database"].map((destination) => <g key={destination} className={destination === "files" ? styles.fileStream : undefined}>
          {Array.from({ length: 3 }, (_, i) => {
            const left = destination === "files";
            const startX = left ? 151 + i * 6 : 350 - (151 + i * 6);
            const endX = left ? 76 + i * 8 : 350 - (76 + i * 8);
            const d = `M ${startX} 316 C ${startX} 365, ${endX} 365, ${endX} 418`;
            const timing = { animationDelay: `${-i * 1.7}s`, animationDuration: "6s" };
            return <g key={i}>
              <path d={d} className={styles.thread} />
              <path d={d} pathLength="100" className={styles.packet} style={timing} />
            </g>;
          })}
        </g>)}
      </svg>
      <Link href="/features/#export" className={styles.fileStack} aria-label="Export workouts as CSV or steps as JSON">
        <div className={styles.jsonSheet}>
          <div className={styles.sheetHeader}><FileJson size={18} aria-hidden /><span>steps.json</span></div>
          <div className={styles.jsonLines} aria-hidden><span>{"{"}</span><i /><i /><i /><span>{"}"}</span></div>
        </div>
        <div className={styles.sheet}>
          <div className={styles.sheetHeader}><FileSpreadsheet size={18} aria-hidden /><span>workouts.csv</span><i /></div>
          <div className={styles.cells} aria-hidden>{Array.from({ length: 20 }, (_, i) => <span key={i}><i /></span>)}</div>
          <div className={styles.sheetFooter} aria-hidden><span /><span /><span /></div>
        </div>
      </Link>
      <div className={styles.phone}>
        <Image src="/screenshots/app-explore.webp" alt="PulsHealth on iPhone, showing real app screens for activity, heart rate, sleep, and workouts" width={600} height={1304} sizes="(max-width: 600px) 46vw, 240px" priority />
      </div>
      <Link href="/server/" className={styles.database} aria-label="Sync to your own database">
        <svg viewBox="0 0 180 180" fill="none" aria-hidden>
          <defs><linearGradient id="cylinder-surface" x1="10" y1="30" x2="160" y2="140" gradientUnits="userSpaceOnUse"><stop stopColor="#5b9ed9" stopOpacity=".4" /><stop offset=".5" stopColor="#183755" /><stop offset="1" stopColor="#244e71" /></linearGradient></defs>
          {[95, 60, 25].map((y) => <g key={y}><path d={`M 20 ${y} V ${y + 32} C 20 ${y + 64} 160 ${y + 64} 160 ${y + 32} V ${y}`} fill="url(#cylinder-surface)" stroke="#80b9e4" strokeOpacity=".45" /><ellipse cx="90" cy={y} rx="70" ry="24" fill="#193a57" stroke="#a9d7ff" strokeOpacity=".65" /><ellipse cx="90" cy={y} rx="49" ry="14" stroke="#98c8f0" strokeOpacity=".16" /></g>)}
          <circle cx="132" cy="78" r="3" fill="#a6e6fd" /><circle cx="132" cy="113" r="3" fill="#a6e6fd" />
        </svg>
        <span>Your database</span>
      </Link>
      <Link href="/docs/ai/" className={styles.ai} aria-label="Connect AI tools through your database"><Sparkles size={22} strokeWidth={1.5} aria-hidden /></Link>
    </div>
    <figcaption className="sr-only">Your Apple Health data flows from the app into exported files or your own database, ready to connect to AI.</figcaption>

  </figure>;
}
