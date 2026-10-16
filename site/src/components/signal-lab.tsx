"use client";

import { useId, useState } from "react";
import { Activity, ArrowDownToLine, Database, Pause, Play } from "lucide-react";
import styles from "./signal-lab.module.css";

const signals = {
  Activity: { color: "#85baff", unit: "steps", values: [24, 42, 30, 70, 48, 88, 62, 96, 74, 100, 60, 80], value: "8,420", description: "See the rhythm of your movement." },
  Sleep: { color: "#b7a5f5", unit: "hours", values: [68, 80, 62, 88, 72, 78, 92, 70, 86, 74, 80, 90], value: "7.8", description: "Make room for the longer view." },
  "Heart rate": { color: "#f4a8bb", unit: "bpm", values: [50, 48, 55, 45, 90, 30, 58, 52, 48, 62, 50, 54], value: "64", description: "Look closer at the individual readings." },
};
type Signal = keyof typeof signals;

/** Illustrative data only. Nothing here reads HealthKit or makes a network request. */
export function SignalLab({ variant = "field" }: { variant?: "field" | "chart" | "sync" | "export" | "detail" }) {
  const id = useId().replace(/:/g, "");
  const [paused, setPaused] = useState(false);
  const [signal, setSignal] = useState<Signal>("Activity");
  const [format, setFormat] = useState("CSV");
  const current = signals[signal];
  const points = current.values.map((v, i) => `${35 + i * 43},${220 - v * 1.6}`).join(" ");

  if (variant === "field") return (
    <div className={styles.field} data-paused={paused}>
      <svg viewBox="0 0 640 610" className={styles.sculpture} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-trace`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#80caff" /><stop offset=".48" stopColor="#5274e9" /><stop offset="1" stopColor="#c4b4f7" /></linearGradient>
          <radialGradient id={`${id}-halo`}><stop stopColor="#244baf" stopOpacity=".3" /><stop offset="1" stopColor="#244baf" stopOpacity="0" /></radialGradient>
        </defs>
        <circle cx="320" cy="300" r="290" fill={`url(#${id}-halo)`} />
        <g className={styles.traces} fill="none" stroke={`url(#${id}-trace)`}>
          {Array.from({ length: 34 }, (_, i) => <path key={i} style={{ animationDelay: `${i * -0.17}s` }} d={`M ${40 + i * 5} ${320 + i * 3} C ${95 + i * 4} ${60 - i * 2}, ${430 - i * 3} ${45 + i * 3}, ${520 - i * 3} ${230 + i * 5} S ${330 + i * 4} ${615 - i * 2}, ${115 + i * 3} ${390 - i * 2} S ${185 + i * 5} ${165 + i * 2}, ${590 - i * 2} ${300 + i * 3}`} opacity={.25 + i / 65} />)}
        </g>
        <g fill="#c9e3ff"><circle cx="186" cy="184" r="4" /><circle cx="497" cy="373" r="4" /><circle cx="267" cy="476" r="3" /></g>
      </svg>
      <div className={styles.fieldLabel}><span className={styles.dot} />Health data, in your hands</div>
      <div className={styles.fieldFoot}><span>Readings become possibilities.</span><button type="button" onClick={() => setPaused(!paused)} aria-label={paused ? "Play signal animation" : "Pause signal animation"} aria-pressed={paused}>{paused ? <Play size={14} /> : <Pause size={14} />}</button></div>
    </div>
  );

  if (variant === "sync") return (
    <div className={styles.sync}>
      <div className={styles.syncNodes}><span><Activity size={28} />Apple Health</span><svg viewBox="0 0 220 70" aria-hidden="true"><path d="M0 35 H220" /><path d="M0 35 H220" strokeDasharray="3 28" className={styles.flow} /></svg><span><Database size={28} />Your database</span></div>
      <div className={styles.records}>{["Heart rate", "Sleep analysis", "Step count", "Workout"].map((name, i) => <div key={name}><span className={styles.recordDot} style={{ opacity: 1 - i * .15 }} /><span>{name}</span><span>Ready to sync</span></div>)}</div>
      <p className={styles.caption}>A growing archive. A destination you choose.</p>
    </div>
  );

  if (variant === "export") return (
    <div className={styles.export}>
      <div className={styles.exportHeading}><ArrowDownToLine size={24} /><span>Take your data with you.</span></div>
      <div className={styles.formatButtons} role="group" aria-label="Preview an export format">{["CSV", "JSON"].map(item => <button key={item} type="button" aria-pressed={format === item} onClick={() => setFormat(item)}>{item}</button>)}</div>
      <pre className={styles.code} aria-live="polite">{format === "CSV" ? "type,value,unit\nstep_count,8420,count\nheart_rate,64,bpm\nsleep_analysis,7.8,hours" : '{\n  "type": "heart_rate",\n  "value": 64,\n  "unit": "bpm"\n}'}</pre>
      <p className={styles.caption}>Illustrative format preview</p>
    </div>
  );

  return (
    <div className={`${styles.chart} ${variant === "detail" ? styles.detail : ""}`} style={{ "--signal-color": current.color } as React.CSSProperties}>
      <div className={styles.chartTop}><span>{variant === "detail" ? "A closer look" : "Find your rhythm"}</span><span>Illustrative data</span></div>
      <div className={styles.signalButtons} role="group" aria-label="Choose a health signal">{(Object.keys(signals) as Signal[]).map(item => <button key={item} type="button" aria-pressed={signal === item} onClick={() => setSignal(item)}>{item}</button>)}</div>
      <div className={styles.reading} aria-live="polite"><strong>{current.value}</strong><span>{current.unit}<br />{current.description}</span></div>
      <svg viewBox="0 0 550 260" role="img" aria-label={`Illustrative ${signal.toLowerCase()} chart`} className={styles.chartSvg}>
        {[60, 110, 160, 210].map(y => <line key={y} x1="30" x2="525" y1={y} y2={y} stroke="currentColor" opacity=".09" />)}
        {variant === "detail" ? current.values.map((v, i) => <rect key={i} x={35 + i * 43} y={220 - v * 1.6} width="20" height={v * 1.6} rx="5" fill="var(--signal-color)" opacity={.3 + i / 20} />) : <><polygon points={`35,240 ${points} 508,240`} fill="var(--signal-color)" opacity=".06" /><polyline points={points} fill="none" stroke="var(--signal-color)" strokeWidth="2.5" strokeLinejoin="round" />{current.values.map((v, i) => <circle key={i} cx={35 + i * 43} cy={220 - v * 1.6} r="3" fill="var(--signal-color)" />)}</>}
        <text x="30" y="258" fill="currentColor" opacity=".6" fontSize="11">Earlier</text><text x="490" y="258" fill="currentColor" opacity=".6" fontSize="11">Later</text>
      </svg>
      <p className={styles.caption}>Explore your own history in the dashboard.</p>
    </div>
  );
}
