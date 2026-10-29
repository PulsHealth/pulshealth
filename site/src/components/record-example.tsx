"use client";

import { useState } from "react";
import type { ExampleRecord } from "@/lib/public-demo-types";
import styles from "./record-example.module.css";

function exampleTime(timestamp: number, origin: number): string {
  const day = Math.floor(timestamp / 86400000) - Math.floor(origin / 86400000) + 1;
  return `Day ${day} · ${new Date(timestamp).toISOString().slice(11, 23)}`;
}

export function RecordExample({ records, categories, dashboardHrefs, recordLabels }: {
  records: ExampleRecord[];
  categories: { value: number; name: string; description?: string }[];
  dashboardHrefs: Record<string, string>;
  recordLabels: Record<string, string>;
}) {
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState("");
  const record = records[selected];
  const json = JSON.stringify(record, null, 2);
  const origin = Math.min(...records.map(r => r.start));
  async function copy(all: boolean) {
    try { await navigator.clipboard.writeText(all ? JSON.stringify(records, null, 2) : json); setStatus(all ? `Copied ${records.length} example records` : "Copied record"); }
    catch { setStatus("Copy unavailable. You can select and copy the JSON below."); }
  }
  function select(index: number) {
    setSelected(index); setStatus("");
    if (matchMedia("(max-width: 800px)").matches) document.getElementById("example-inspector")?.scrollIntoView({ behavior: "instant", block: "start" });
  }
  return (
    <>
      <div className={styles.toolbar}>
        <button type="button" onClick={() => copy(true)}>Copy all records as JSON</button>
      </div>
      <div className={styles.grid}>
        <section className={styles.list} aria-label="Example records">
          <div className={styles.listHeader}><span>Sample interval</span><span>{record.kind === "quantity" ? `Value · ${record.unit}` : "Category code"}</span></div>
          {records.map((r, index) => (
            <button key={r.uuid} type="button" aria-pressed={index === selected} className={styles.row} onClick={() => select(index)}>
              <span><span>{exampleTime(r.start, origin)}</span><small>{recordLabels[r.type] && <>{recordLabels[r.type]} · </>}{r.sourceName ?? "Source not included"}</small></span>
              <span className={styles.value}>{r.value ?? r.category}<small>{r.kind === "category" ? categories.find(c => c.value === r.category)?.name : ""}</small></span>
            </button>
          ))}
        </section>
        <section className={styles.inspector} id="example-inspector" aria-label="Selected example record">
          <div className={styles.inspectorHeader}><h2>Record {selected + 1}</h2><button type="button" onClick={() => copy(false)}>Copy JSON</button></div>
          {dashboardHrefs[record.type] && <a className={styles.dashboardLink} href={dashboardHrefs[record.type]} target="_blank" rel="noopener noreferrer">View in dashboard ↗</a>}
          <p className={styles.status} role="status" aria-live="polite">{status}</p>
          <pre className={styles.json} aria-label="Full example record JSON"><code>{json}</code></pre>
        </section>
      </div>
    </>
  );
}
