"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check, FileJson2, Heart, Moon, Footprints, RotateCcw } from "lucide-react";
import styles from "./data-journeys.module.css";

const measurements = [
  { name: "Heart rate", slug: "heart-rate", color: "#f4a8bb", icon: Heart, reading: "64 bpm", values: [33, 38, 28, 54, 23, 44, 35, 40, 29, 35, 48, 38] },
  { name: "Sleep", slug: "sleep", color: "#b7a5f5", icon: Moon, reading: "7.8 hours", values: [38, 46, 30, 52, 40, 48, 35, 43, 50, 38, 45, 49] },
  { name: "Steps", slug: "steps", color: "#85baff", icon: Footprints, reading: "8,420 steps", values: [20, 38, 28, 49, 32, 44, 25, 50, 40, 33, 52, 38] },
] as const;

/** Run once when visible, then only on interaction. Reduced motion settles immediately. */
function useJourney() {
  const root = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [iteration, setIteration] = useState(0);
  const replay = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setIteration(value => value + 1);
    setRunning(true);
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        replay();
        observer.disconnect();
      }
    }, { threshold: .45 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [replay]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setRunning(false), 2800);
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => { if (preference.matches) setRunning(false); };
    preference.addEventListener("change", settle);
    return () => { window.clearTimeout(timer); preference.removeEventListener("change", settle); };
  }, [iteration, running]);

  return { root, running, iteration, replay };
}

export function SyncJourney() {
  const databaseId = useId().replace(/:/g, "");
  const { root, running, iteration, replay } = useJourney();
  const [selected, setSelected] = useState(0);
  const measurement = measurements[selected];

  return (
    <div ref={root} className={styles.journey} style={{ "--journey-color": measurement.color } as CSSProperties} data-running={running}>
      <div className={styles.sceneHeading}><span>Many signals. One personal archive.</span><span>Illustration</span></div>
      <div className={styles.measurements} role="group" aria-label="Choose a signal to sync">
        {measurements.map(({ name, icon: Icon }, index) => <button type="button" key={name} aria-pressed={selected === index} onClick={() => { setSelected(index); replay(); }}><Icon size={15} aria-hidden />{name}</button>)}
      </div>
      <svg key={iteration} className={styles.syncScene} viewBox="0 0 640 350" role="img" aria-label="Heart rate, sleep, and steps flow from Apple Health into your database">
        <defs><linearGradient id={`database-${databaseId}`} x1="0" y1="0" x2="1" y2="0"><stop stopColor="#162b49" /><stop offset=".6" stopColor="#0e1d35" /><stop offset="1" stopColor="#1e3657" /></linearGradient></defs>
        <g fill="none" stroke="#ffffff0d"><ellipse cx="482" cy="288" rx="128" ry="32" /><ellipse cx="482" cy="288" rx="101" ry="24" /><path d="M34 300 H606" /></g>
        {measurements.map(({ color, values }, index) => {
          const y = 72 + index * 84;
          const path = `M 165 ${y} C 265 ${y}, 272 ${154 + index * 19}, 402 ${154 + index * 19}`;
          return <g key={color} opacity={selected === index ? 1 : .35}>
            <path d={`M30 ${y + 17} ${values.map((v, i) => `L${35 + i * 10} ${y + 35 - v}`).join(" ")}`} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
            <circle cx="166" cy={y} r="4" fill={color} />
            <path d={path} fill="none" stroke={color} strokeOpacity=".3" />
            <path className={styles.packet} d={path} pathLength="100" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" style={{ animationDelay: `${index * .15}s` }} />
          </g>;
        })}
        <g className={styles.database}>
          <path d="M402 112 V251 C402 282 566 282 566 251 V112" fill={`url(#database-${databaseId})`} stroke="#7094c3" strokeOpacity=".65" />
          {[146, 181, 216, 251].map((y, i) => <g key={y} className={styles.databaseLayer} style={{ animationDelay: `${.9 + i * .2}s` }}><path d={`M402 ${y} C402 ${y + 32} 566 ${y + 32} 566 ${y}`} fill="none" stroke={i === selected ? measurement.color : "#5477a5"} strokeOpacity={i === selected ? 1 : .4} /><circle cx="542" cy={y + 9} r="2.5" fill={i === selected ? measurement.color : "#7094c3"} /></g>)}
          <ellipse cx="484" cy="112" rx="82" ry="23" fill="#142741" stroke="#799dcd" strokeOpacity=".7" />
          <ellipse cx="484" cy="112" rx="61" ry="13" fill="none" stroke="#85baff" strokeOpacity=".2" />
        </g>
      </svg>
      <div className={styles.endpoints}><span>Apple Health</span><ArrowRight size={16} aria-hidden /><span>Your database</span></div>
      <div className={styles.receipt} aria-live="polite"><span className={styles.statusDot} /><span>{measurement.name}</span><strong>{measurement.reading}</strong><span>{running ? "Flowing into your archive" : "A reading, preserved"}</span></div>
      <div className={styles.sceneFooter}><p>Illustrative data. Your sync uses the destination you choose.</p><button type="button" onClick={replay} aria-label="Replay sync illustration"><RotateCcw size={13} aria-hidden />Replay</button></div>
    </div>
  );
}

export function ExportJourney() {
  const { root, running, iteration, replay } = useJourney();
  const [selected, setSelected] = useState(0);
  const [format, setFormat] = useState<"CSV" | "JSON">("CSV");
  const [days, setDays] = useState("30");
  const measurement = measurements[selected];
  const Icon = measurement.icon;

  return (
    <div ref={root} className={`${styles.journey} ${styles.exportJourney}`} style={{ "--journey-color": measurement.color } as CSSProperties} data-running={running}>
      <div className={styles.sceneHeading}><span>From a signal to something you can use.</span><span>Illustration</span></div>
      <div className={styles.exportControls}>
        <label>Data<select value={selected} onChange={event => { setSelected(Number(event.target.value)); replay(); }}>{measurements.map(({ name }, index) => <option key={name} value={index}>{name}</option>)}</select></label>
        <label>Range<select value={days} onChange={event => { setDays(event.target.value); replay(); }}><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
        <div className={styles.formatControl} role="group" aria-label="Choose an export format">{(["CSV", "JSON"] as const).map(item => <button type="button" key={item} aria-pressed={format === item} onClick={() => { setFormat(item); replay(); }}>{item}</button>)}</div>
      </div>
      <div key={iteration} className={styles.exportScene}>
        <div className={styles.sourceSignal} aria-hidden="true"><Icon size={28} strokeWidth={1.4} /><div className={styles.signalBars}>{measurement.values.map((value, i) => <span key={i} style={{ height: `${value}%` }} />)}</div><span>{measurement.name}</span></div>
        <svg className={styles.exportStream} viewBox="0 0 180 220" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <g key={i}><path d={`M0 ${38 + i * 35} C85 ${38 + i * 35}, 85 110, 180 110`} fill="none" stroke="var(--journey-color)" opacity=".18" /><path className={styles.packet} pathLength="100" d={`M0 ${38 + i * 35} C85 ${38 + i * 35}, 85 110, 180 110`} fill="none" stroke="var(--journey-color)" strokeWidth="2" style={{ animationDelay: `${i * .1}s` }} /></g>)}</svg>
        <div className={styles.fileSheet}>
          <div className={styles.fileHeading}><FileJson2 size={21} strokeWidth={1.4} aria-hidden /><span>.{format.toLowerCase()}</span></div>
          {format === "CSV" ? <div className={styles.sheetGrid} aria-label="Spreadsheet illustration"><div><span>time</span><span>value</span><span>unit</span></div>{Array.from({ length: 5 }, (_, i) => <div key={i}><span className={styles.sheetLine} /><span className={styles.sheetLine} /><span className={styles.sheetLine} /></div>)}</div> : <div className={styles.jsonLines} aria-label="JSON illustration"><span>{"{"}</span><span><i />&quot;type&quot;: &quot;{measurement.slug}&quot;,</span><span><i />&quot;value&quot;: {selected === 0 ? "64" : selected === 1 ? "7.8" : "8420"}</span><span>{"}"}</span></div>}
          <div className={styles.fileSeal}><Check size={13} aria-hidden />Yours to keep</div>
        </div>
      </div>
      <div className={styles.fileDescription} aria-live="polite"><strong>{measurement.slug}.{format.toLowerCase()}</strong><span>{days} days of {measurement.name.toLowerCase()}. {format === "CSV" ? "Ready for your spreadsheet." : "Ready for your own tools."}</span></div>
      <div className={styles.sceneFooter}><p>Illustrative preview. Create your own export in the iPhone app.</p><button type="button" onClick={replay} aria-label="Replay export illustration"><RotateCcw size={13} aria-hidden />Replay</button></div>
    </div>
  );
}
